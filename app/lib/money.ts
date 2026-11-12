/**
 * Every money operation in the app. Nothing outside this file does arithmetic on an
 * amount.
 *
 * Amounts are `bigint` in memory and decimal strings on the wire, never `number`. A
 * double cannot hold 1,200.07 USDC exactly, and the contract decides an invoice is
 * settled by comparing `paid` to `amount` for equality. One rounding error and the UI
 * disagrees with the chain about whether somebody has been paid.
 *
 * The unit everywhere is the token's smallest unit: 1 USDC is `1_000_000n`.
 */

/** USDC, and every token Ileri accepts, has 6 decimals. */
export const DECIMALS = 6;

const SCALE = 10n ** BigInt(DECIMALS);

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Parse what somebody typed into the smallest unit.
 *
 * Accepts `1200`, `1200.07`, `1,200.07`, a leading `+`, and surrounding space. Rejects
 * anything else rather than guessing, because silently reading `12OO` as 12 would be
 * worse than refusing it. Done with string surgery; `parseFloat` never touches an amount.
 */
export function parseAmount(input: string): bigint {
  const cleaned = input.trim().replace(/,/g, "").replace(/^\+/, "");

  if (cleaned === "") throw new MoneyError("Enter an amount");
  if (cleaned.startsWith("-")) throw new MoneyError("Amount cannot be negative");
  if (cleaned === "." || !/^\d*\.?\d*$/.test(cleaned)) {
    throw new MoneyError("Amount must be a number, like 1200.50");
  }

  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > DECIMALS) {
    throw new MoneyError(`At most ${DECIMALS} decimal places`);
  }

  // Right-pad so "1.5" and "1.500000" are the same amount.
  const padded = fraction.padEnd(DECIMALS, "0");
  const value = BigInt(whole || "0") * SCALE + BigInt(padded || "0");
  if (value === 0n) throw new MoneyError("Amount must be more than zero");
  return value;
}

/**
 * The smallest unit as a decimal string: `1200000000n` becomes `"1,200.00"`.
 *
 * Always at least two decimal places so a column of amounts lines up, and more only when
 * the amount genuinely has them, rather than hiding part of what somebody owes.
 */
export function formatAmount(
  raw: bigint | string,
  opts: { grouped?: boolean } = {},
): string {
  const value = toBigInt(raw);
  const whole = value / SCALE;
  const fraction = value % SCALE;

  const digits = fraction.toString().padStart(DECIMALS, "0");
  const trimmed = digits.replace(/0+$/, "");
  const shown = trimmed.length <= 2 ? digits.slice(0, 2) : trimmed;

  const wholeText = opts.grouped === false ? whole.toString() : group(whole.toString());
  return `${wholeText}.${shown}`;
}

/** `1200000000n` becomes `"1,200.00 USDC"`. What most screens want. */
export function formatWithSymbol(raw: bigint | string, symbol = "USDC"): string {
  return `${formatAmount(raw)} ${symbol}`;
}

/** Thousands separators. Display only. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * What is still owed.
 *
 * Clamped at zero rather than going negative: the contract refunds an overpayment, so
 * from the UI's point of view nothing is ever owed less than nothing.
 */
export function unpaid(amount: bigint | string, paid: bigint | string): bigint {
  const total = toBigInt(amount);
  const settled = toBigInt(paid);
  return settled >= total ? 0n : total - settled;
}

/**
 * Whether an invoice is settled.
 *
 * The one rule the whole app hangs on: "Paid" means the contract's `paid` has reached
 * `amount`. Never 1Click's status, never a database row, never an optimistic update.
 */
export function isSettled(amount: bigint | string, paid: bigint | string): boolean {
  return toBigInt(paid) >= toBigInt(amount);
}

/**
 * How far along a payment is, 0 to 100, for a progress bar. Display only.
 *
 * Beware: a real but negligible payment reports `0`. One unit of a 1,200 USDC invoice is
 * 0.00008%, which rounds to nothing, and that is the honest percentage. So a caller must
 * never infer "nothing has been paid" from this returning zero — check `paid > 0n` for
 * that. An empty progress bar on an invoice that has received money would tell the issuer
 * something false.
 */
export function paidPercent(amount: bigint | string, paid: bigint | string): number {
  const total = toBigInt(amount);
  if (total === 0n) return 0;
  const settled = toBigInt(paid);
  if (settled >= total) return 100;
  // Scale before dividing, or integer division collapses everything to zero.
  return Number((settled * 10_000n) / total) / 100;
}

/**
 * What a buyer stands to gain on a listing if the client pays in full.
 *
 * In the smallest unit, so it is still money and still exact.
 */
export function discount(unpaidAmount: bigint | string, price: bigint | string): bigint {
  const owed = toBigInt(unpaidAmount);
  const asking = toBigInt(price);
  return asking >= owed ? 0n : owed - asking;
}

/**
 * That discount as a percentage of what is owed, to one decimal place.
 *
 * A rate is not money, so a `number` is right here. It is derived for display and never
 * fed back into an amount.
 */
export function discountPercent(
  unpaidAmount: bigint | string,
  price: bigint | string,
): number {
  const owed = toBigInt(unpaidAmount);
  if (owed === 0n) return 0;
  return Number((discount(owed, price) * 1000n) / owed) / 10;
}

/**
 * The same discount as a yearly rate, which is how somebody pricing invoices actually
 * thinks: 3% over 30 days is far dearer than 3% over a year.
 *
 * Simple, not compounded, and deliberately rough. `null` when the due date has passed or
 * is today, because an annual rate over zero days is meaningless rather than infinite.
 */
export function annualisedDiscount(
  unpaidAmount: bigint | string,
  price: bigint | string,
  daysToDue: number,
): number | null {
  if (daysToDue <= 0) return null;
  if (toBigInt(unpaidAmount) === 0n) return null;
  return (discountPercent(unpaidAmount, price) * 365) / daysToDue;
}

/** Whole days from now until `dueDate`, which the contract reports in nanoseconds. */
export function daysUntil(dueDateNs: bigint | string, now: Date = new Date()): number {
  const dueMs = Number(toBigInt(dueDateNs) / 1_000_000n);
  return Math.ceil((dueMs - now.getTime()) / 86_400_000);
}

/**
 * Accept what the contract sends.
 *
 * Every `U128` and `U64` crosses the ABI as a decimal string, so this is the one door
 * amounts come through. It rejects anything that is not digits, which catches a `number`
 * that lost precision on the way in.
 */
export function toBigInt(value: bigint | string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new MoneyError("Amount cannot be negative");
    return value;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new MoneyError(`Not an amount in smallest units: ${JSON.stringify(value)}`);
  }
  return BigInt(trimmed);
}

/** For sending to the contract, which takes `U128` as a decimal string. */
export function toRaw(value: bigint): string {
  if (value < 0n) throw new MoneyError("Amount cannot be negative");
  return value.toString();
}

/**
 * Add up a column of amounts.
 *
 * Here rather than inline in a page, because adding money is still doing arithmetic on
 * money, and the whole point of this file is that nowhere else does any. A page that
 * wrote `.reduce((a, b) => a + Number(b))` would be one rounding error away from telling
 * somebody the wrong total.
 */
export function sum(values: Iterable<bigint | string>): bigint {
  let total = 0n;
  for (const value of values) total += toBigInt(value);
  return total;
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];
/** Groups of three, smallest first. Beyond this the words stop helping anybody. */
const SCALES = ["", " thousand", " million", " billion", " trillion"];

/** 0 to 999, in words. */
function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const unit = n % 10;
    return unit === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ONES[unit]}`;
  }
  const rest = n % 100;
  const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
  return rest === 0 ? hundreds : `${hundreds} ${underThousand(rest)}`;
}

/**
 * The amount written out, the way a cheque writes it.
 *
 * A bearer instrument states its value twice, in figures and in words, because words
 * cannot be altered by adding a nought. That is the whole reason this exists, and it is
 * why the design puts it under the amount on every sheet.
 *
 * `null` for anything at or above a quadrillion, rather than inventing scale names
 * nobody uses. The caller omits the line instead of printing something wrong.
 *
 * The fraction is never rounded. Two decimal places get the familiar `/100`; anything
 * finer is shown over the full six, because an invoice for 0.000001 USDC owes exactly
 * that and the sheet must not say it owes nothing.
 */
export function amountInWords(raw: bigint | string): string | null {
  const value = toBigInt(raw);
  const whole = value / SCALE;
  const fraction = value % SCALE;

  const groups: string[] = [];
  let left = whole;
  let scale = 0;
  if (left === 0n) {
    groups.push(ONES[0]);
  }
  while (left > 0n) {
    if (scale >= SCALES.length) return null;
    const group = Number(left % 1000n);
    if (group > 0) groups.unshift(`${underThousand(group)}${SCALES[scale]}`);
    left /= 1000n;
    scale += 1;
  }

  // Hundredths when the amount is a round number of them, the exact six otherwise.
  const over100 = fraction % 10_000n === 0n;
  const fractionText = over100
    ? `${(fraction / 10_000n).toString().padStart(2, "0")}/100`
    : `${fraction.toString().padStart(DECIMALS, "0")}/${SCALE.toString()}`;

  const words = `${groups.join(" ")} and ${fractionText}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
