import { describe, expect, it } from "vitest";
import {
  DECIMALS,
  MoneyError,
  annualisedDiscount,
  daysUntil,
  discount,
  discountPercent,
  formatAmount,
  formatWithSymbol,
  isSettled,
  paidPercent,
  parseAmount,
  toBigInt,
  toRaw,
  unpaid,
} from "./money";

const USDC = 1_000_000n;

describe("parseAmount", () => {
  it("reads whole and fractional amounts", () => {
    expect(parseAmount("1200")).toBe(1200n * USDC);
    expect(parseAmount("1200.07")).toBe(1_200_070_000n);
    expect(parseAmount("0.000001")).toBe(1n);
  });

  it("accepts the shapes people actually type", () => {
    expect(parseAmount("1,200.50")).toBe(1_200_500_000n);
    expect(parseAmount("  1200  ")).toBe(1200n * USDC);
    expect(parseAmount("+1200")).toBe(1200n * USDC);
    // "1.5" and "1.500000" are the same money.
    expect(parseAmount("1.5")).toBe(parseAmount("1.500000"));
  });

  it("never loses a cent to floating point", () => {
    // 0.1 + 0.2 !== 0.3 in a double. It must here.
    expect(parseAmount("0.1") + parseAmount("0.2")).toBe(parseAmount("0.3"));
    // A value a double cannot represent exactly.
    expect(parseAmount("8191.310000")).toBe(8_191_310_000n);
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const bad of ["", " ", ".", "abc", "12OO", "1.2.3", "1e6", "-5", "0"]) {
      expect(() => parseAmount(bad), bad).toThrow(MoneyError);
    }
  });

  it("refuses more precision than the token has", () => {
    expect(() => parseAmount("1.0000001")).toThrow(/decimal places/);
    expect(parseAmount("1.000001")).toBe(1_000_001n);
  });
});

describe("formatAmount", () => {
  it("always shows at least two decimal places so columns line up", () => {
    expect(formatAmount(1200n * USDC)).toBe("1,200.00");
    expect(formatAmount(1_200_500_000n)).toBe("1,200.50");
    expect(formatAmount(0n)).toBe("0.00");
  });

  it("shows the extra places when the amount really has them", () => {
    // Hiding part of what somebody owes would be worse than an untidy column.
    expect(formatAmount(1_200_000_001n)).toBe("1,200.000001");
    expect(formatAmount(1n)).toBe("0.000001");
  });

  it("groups thousands, and can be asked not to", () => {
    expect(formatAmount(1_234_567n * USDC)).toBe("1,234,567.00");
    expect(formatAmount(1200n * USDC, { grouped: false })).toBe("1200.00");
  });

  it("round-trips through parseAmount", () => {
    for (const raw of [1n, 999n, 1_000_000n, 1_200_070_000n, 98_765_432_100n]) {
      expect(parseAmount(formatAmount(raw))).toBe(raw);
    }
  });

  it("handles an amount far beyond what a double could hold", () => {
    const huge = 2n ** 100n;
    expect(() => formatAmount(huge)).not.toThrow();
    expect(parseAmount(formatAmount(huge))).toBe(huge);
  });

  it("adds a symbol when asked", () => {
    expect(formatWithSymbol(1200n * USDC)).toBe("1,200.00 USDC");
  });
});

describe("settlement", () => {
  const amount = 1200n * USDC;

  it("is settled only once paid reaches amount", () => {
    expect(isSettled(amount, 0n)).toBe(false);
    expect(isSettled(amount, amount - 1n)).toBe(false);
    expect(isSettled(amount, amount)).toBe(true);
  });

  it("treats an overpayment as settled, never as owing less than nothing", () => {
    expect(isSettled(amount, amount + USDC)).toBe(true);
    expect(unpaid(amount, amount + USDC)).toBe(0n);
  });

  it("reports what is still owed", () => {
    expect(unpaid(amount, 200n * USDC)).toBe(1000n * USDC);
    expect(unpaid(amount, 0n)).toBe(amount);
  });

  it("accepts the decimal strings the contract sends", () => {
    expect(isSettled("1200000000", "1200000000")).toBe(true);
    expect(unpaid("1200000000", "200000000")).toBe(1000n * USDC);
  });

  it("reports progress without collapsing to zero", () => {
    expect(paidPercent(amount, 0n)).toBe(0);
    expect(paidPercent(amount, 600n * USDC)).toBe(50);
    expect(paidPercent(amount, amount)).toBe(100);
    // A payment worth noticing registers.
    expect(paidPercent(amount, USDC)).toBeCloseTo(0.08, 2);
    expect(paidPercent(0n, 0n)).toBe(0);
  });

  it("reports 0% for a negligible payment, which is why 0% is not 'unpaid'", () => {
    // One unit of a 1,200 USDC invoice really is 0.00008%. The percentage is honest; the
    // trap is a caller reading 0 as "nothing arrived" and drawing an empty bar.
    expect(paidPercent(amount, 1n)).toBe(0);
    expect(unpaid(amount, 1n)).toBeLessThan(amount);
    expect(isSettled(amount, 1n)).toBe(false);
  });
});

describe("the market maths", () => {
  const owed = 1000n * USDC;

  it("prices the upside in exact money", () => {
    expect(discount(owed, 900n * USDC)).toBe(100n * USDC);
    expect(discountPercent(owed, 900n * USDC)).toBe(10);
  });

  it("never shows a negative upside", () => {
    // The contract refuses a price at or above the unpaid balance, but a part payment
    // after listing can still push the balance below the asking price.
    expect(discount(owed, owed)).toBe(0n);
    expect(discount(owed, owed + USDC)).toBe(0n);
    expect(discountPercent(owed, owed)).toBe(0);
  });

  it("annualises, because 3% over a month is not 3% over a year", () => {
    // 10% over 30 days is roughly 122% a year.
    expect(annualisedDiscount(owed, 900n * USDC, 30)).toBeCloseTo(121.67, 1);
    // The same discount over a year is just the discount.
    expect(annualisedDiscount(owed, 900n * USDC, 365)).toBeCloseTo(10, 5);
  });

  it("declines to annualise over zero or negative days", () => {
    // An annual rate over no time is meaningless, not infinite.
    expect(annualisedDiscount(owed, 900n * USDC, 0)).toBeNull();
    expect(annualisedDiscount(owed, 900n * USDC, -5)).toBeNull();
    expect(annualisedDiscount(0n, 0n, 30)).toBeNull();
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  const ns = (date: string) => BigInt(new Date(date).getTime()) * 1_000_000n;

  it("counts whole days from nanoseconds", () => {
    expect(daysUntil(ns("2026-12-11T00:00:00Z"), now)).toBe(30);
    expect(daysUntil(ns("2026-11-12T00:00:00Z"), now)).toBe(1);
  });

  it("goes negative once overdue, so callers can tell", () => {
    expect(daysUntil(ns("2026-11-01T00:00:00Z"), now)).toBe(-10);
  });
});

describe("the boundary with the contract", () => {
  it("accepts decimal strings and bigints", () => {
    expect(toBigInt("1200000000")).toBe(1200n * USDC);
    expect(toBigInt(1200n * USDC)).toBe(1200n * USDC);
    expect(toBigInt("0")).toBe(0n);
  });

  it("rejects anything that is not digits", () => {
    // Catches a number that already lost precision on the way in.
    for (const bad of ["1200.00", "1e9", "", " ", "-1", "0x10", "1_000"]) {
      expect(() => toBigInt(bad), bad).toThrow(MoneyError);
    }
  });

  it("rejects negatives from either direction", () => {
    expect(() => toBigInt(-1n)).toThrow(MoneyError);
    expect(() => toRaw(-1n)).toThrow(MoneyError);
  });

  it("sends amounts back as decimal strings", () => {
    expect(toRaw(1200n * USDC)).toBe("1200000000");
    // Well past 2^53, where a number would silently lie.
    expect(toRaw(2n ** 90n)).toBe((2n ** 90n).toString());
  });

  it("agrees with the contract about the token's decimals", () => {
    expect(DECIMALS).toBe(6);
  });
});
