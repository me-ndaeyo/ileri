/**
 * The token image: the instrument itself, drawn from the token id alone.
 *
 * The contract deliberately keeps NFT metadata generic, so a wallet or explorer shows
 * nothing private. That left the row blank, which is no good either. This is the answer:
 * the image IS the bearer document, and every line of it is derived from the serial, so
 * it can sit on a public marketplace without leaking a name, an amount, a due date or a
 * counterparty.
 *
 * What goes in: the wordmark, the serial, the contract id, and the status. Status is
 * already public on chain, and without it the image would say "paid" about an invoice
 * that is not.
 *
 * What never goes in: issuer, client, holder, amount, paid, due date, document hash.
 * There is a test for that, because this is the one file where a careless addition would
 * publish something.
 *
 * The geometry is seeded from the id, so two invoices never look identical and the same
 * invoice always looks the same. Nothing is random: the same id in two years renders the
 * same engraving.
 */

/** The statuses the contract can report, as the stamp words and their ink. */
const STAMPS: Record<string, { word: string; ink: string }> = {
  Issued: { word: "Issued", ink: "#5A5E6B" },
  Accepted: { word: "Accepted", ink: "#2A3F7A" },
  PartiallyPaid: { word: "Part paid", ink: "#2A3F7A" },
  Paid: { word: "Paid", ink: "#1C5B40" },
  Overdue: { word: "Overdue", ink: "#8A2B2B" },
  Rejected: { word: "Rejected", ink: "#171A24" },
  Cancelled: { word: "Cancelled", ink: "#5A5E6B" },
};

const INK = "#171A24";
const SHEET = "#FBFAF5";
const RULE = "#CEC6B2";

/**
 * A woven band of sine lines, as across the head of a banknote. Two frequencies, so it
 * reads as engine-turned engraving rather than a ripple.
 */
function bandPaths(
  width: number,
  height: number,
  lines: number,
  seed: number,
  steps = 96,
): string[] {
  const mid = height / 2;
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    const phase = ((i + seed) / lines) * 2 * Math.PI;
    const points: string[] = [];
    for (let s = 0; s <= steps; s += 1) {
      const x = (width * s) / steps;
      const t = (x / width) * 2 * Math.PI;
      const y =
        mid +
        height * 0.3 * Math.sin((2 + seed * 0.37) * t + phase) +
        height * 0.14 * Math.sin((5 + seed * 0.61) * t - phase * 1.7);
      points.push(`${x.toFixed(0)} ${y.toFixed(1)}`);
    }
    out.push(`M${points.join("L")}`);
  }
  return out;
}

/** An epitrochoid: the circular guilloche of a seal or a share certificate. */
function rosettePath(
  radius: number,
  petals: number,
  depth: number,
  cx: number,
  cy: number,
  steps = 220,
): string {
  const r = radius / petals;
  const d = radius * depth;
  const points: string[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const t = (2 * Math.PI * s) / steps;
    const x = (radius - r) * Math.cos(t) + d * Math.cos(((radius - r) / r) * t);
    const y = (radius - r) * Math.sin(t) - d * Math.sin(((radius - r) / r) * t);
    points.push(`${(cx + x).toFixed(1)} ${(cy + y).toFixed(1)}`);
  }
  return `M${points.join("L")}Z`;
}

/** Every varying part of the engraving, decided by the serial and nothing else. */
function seedFrom(id: string): { phase: number; petals: number; inner: number; depth: number } {
  // The id is a u64 from the contract, so it can be larger than Number holds safely.
  const n = BigInt(id);
  return {
    phase: Number(n % 9n),
    petals: 7 + Number(n % 5n),
    inner: 11 + Number((n / 5n) % 5n),
    depth: 0.34 + Number(n % 4n) * 0.04,
  };
}

/** XML-escape. The only interpolated values are a serial and an account id, but still. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The 600x600 token image.
 *
 * Square because that is what wallets and marketplaces crop to, and legible down to the
 * 64px row: at that size the wordmark and the serial are all that survive, which is the
 * test the design has to pass.
 */
export function instrumentSvg({
  id,
  contractId,
  status,
}: {
  id: string;
  contractId: string;
  status: string;
}): string {
  if (!/^\d+$/.test(id)) throw new Error(`Not a token id: ${JSON.stringify(id)}`);

  const seed = seedFrom(id);
  const stamp = STAMPS[status] ?? STAMPS.Issued;
  const serial = `No. ${id.padStart(10, "0")}`;

  const band = bandPaths(600, 46, 9, seed.phase)
    .map((d) => `<path d="${d}"/>`)
    .join("");
  const rosette =
    `<path d="${rosettePath(150, seed.petals, seed.depth, 300, 300)}"/>` +
    `<path d="${rosettePath(150, seed.inner, seed.depth * 0.7, 300, 300)}"/>`;

  // The comb foot, where a note is torn when it is cashed or sold.
  const teeth: string[] = [];
  for (let x = 24; x < 600; x += 18) teeth.push(`M${x} 576V600`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="Ileri invoice ${esc(serial)}, ${esc(stamp.word)}">
<rect width="600" height="600" fill="${SHEET}"/>
<g fill="none" stroke="${INK}" stroke-width="0.6" opacity="0.26">${band}</g>
<g transform="translate(0 554)" fill="none" stroke="${INK}" stroke-width="0.6" opacity="0.26">${band}</g>
<g fill="none" stroke="${INK}" stroke-width="0.6" opacity="0.3">${rosette}</g>
<text x="300" y="214" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="92" fill="${INK}">Ileri</text>
<text x="300" y="248" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="17" letter-spacing="1.6" fill="#5A5E6B">Promise to pay the bearer</text>
<text x="300" y="330" text-anchor="middle" font-family="'SFMono-Regular',Menlo,monospace" font-size="30" letter-spacing="4.2" fill="${INK}">${esc(serial)}</text>
<g transform="translate(300 400)">
<rect x="-104" y="-30" width="208" height="60" fill="none" stroke="${stamp.ink}" stroke-width="2.4" transform="rotate(-3)"/>
<rect x="-97" y="-23" width="194" height="46" fill="none" stroke="${stamp.ink}" stroke-width="1.4" transform="rotate(-3)"/>
<text y="9" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="bold" letter-spacing="3.4" fill="${stamp.ink}" transform="rotate(-3)">${esc(stamp.word)}</text>
</g>
<text x="300" y="524" text-anchor="middle" font-family="'SFMono-Regular',Menlo,monospace" font-size="16" fill="#5A5E6B">${esc(contractId)}</text>
<g stroke="${RULE}" stroke-width="1.4">${teeth.join("")}</g>
</svg>`;
}
