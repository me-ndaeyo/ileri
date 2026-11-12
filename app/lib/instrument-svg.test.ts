import { describe, expect, it } from "vitest";
import { instrumentSvg } from "@/lib/instrument-svg";

const ARGS = { id: "7", contractId: "ileri.testnet", status: "Accepted" };

describe("the token image", () => {
  // This is the test the file exists for. The image is public on every marketplace that
  // indexes the contract, so anything that reaches it is published. The contract keeps
  // NFT metadata generic on purpose, and this must not undo that.
  it("carries nothing private, whatever it is given", () => {
    const svg = instrumentSvg(ARGS);
    const forbidden = [
      "test-issuer.testnet",
      "northwind.testnet",
      "buyer.testnet",
      "4,250.00",
      "4250",
      "December",
      "usdc",
      "due",
    ];
    for (const secret of forbidden) {
      expect(svg.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("says what it is: the wordmark, the serial, the contract and the status", () => {
    const svg = instrumentSvg(ARGS);
    expect(svg).toContain("Ileri");
    expect(svg).toContain("No. 0000000007");
    expect(svg).toContain("ileri.testnet");
    expect(svg).toContain("Accepted");
  });

  // The engraving is the invoice's fingerprint, so it has to be stable. If this ever
  // changes, every token image on every marketplace changes with it.
  it("renders the same id identically, every time", () => {
    expect(instrumentSvg(ARGS)).toBe(instrumentSvg(ARGS));
  });

  it("gives different invoices different engraving", () => {
    const a = instrumentSvg({ ...ARGS, id: "7" });
    const b = instrumentSvg({ ...ARGS, id: "8" });
    expect(a).not.toBe(b);
    // Not merely a different serial: the guilloche itself differs.
    const paths = (svg: string) => svg.match(/<path d="M[^"]+"\/>/g)?.join("") ?? "";
    expect(paths(a)).not.toBe(paths(b));
  });

  it("stamps each status in its own ink", () => {
    expect(instrumentSvg({ ...ARGS, status: "Paid" })).toContain("#1C5B40");
    expect(instrumentSvg({ ...ARGS, status: "Overdue" })).toContain("#8A2B2B");
    expect(instrumentSvg({ ...ARGS, status: "Rejected" })).toContain("Rejected");
  });

  // An unknown status must not render a blank stamp or crash a marketplace's fetcher.
  it("falls back to issued for a status it does not know", () => {
    expect(instrumentSvg({ ...ARGS, status: "Nonsense" })).toContain("Issued");
  });

  // Token ids are u64 on chain, which is past what a Number holds exactly. Seeding via
  // Number(id) would collide for large ids and give two invoices the same engraving.
  it("handles a token id beyond Number's exact range", () => {
    const big = "18446744073709551615"; // u64 max
    const svg = instrumentSvg({ ...ARGS, id: big });
    expect(svg).toContain(`No. ${big}`);
    expect(svg).not.toBe(instrumentSvg({ ...ARGS, id: "18446744073709551614" }));
  });

  it("refuses anything that is not a token id", () => {
    expect(() => instrumentSvg({ ...ARGS, id: "7; rm -rf" })).toThrow();
    expect(() => instrumentSvg({ ...ARGS, id: "" })).toThrow();
    expect(() => instrumentSvg({ ...ARGS, id: "-1" })).toThrow();
  });

  it("escapes what it interpolates", () => {
    const svg = instrumentSvg({ ...ARGS, contractId: 'a"<b>&c' });
    expect(svg).toContain("a&quot;&lt;b&gt;&amp;c");
    expect(svg).not.toContain("<b>");
  });
});
