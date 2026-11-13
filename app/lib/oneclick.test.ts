import { describe, expect, it } from "vitest";
import { OneClickError, buildQuoteRequest } from "@/lib/oneclick";

const DEADLINE = new Date("2026-11-13T12:00:00.000Z");

const ARGS = {
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  unpaidAmount: "4250000000",
  invoiceId: "7",
  recipient: "ileri.near",
  refundTo: "0x1111111111111111111111111111111111111111",
  deadline: DEADLINE,
} as const;

describe("the 1Click quote request", () => {
  // 1Click is mainnet only, so this is the only part of the integration that can be
  // checked without spending real money. It is therefore the part worth checking hard.
  it("asks for an exact output, never an exact input", () => {
    const request = buildQuoteRequest({ ...ARGS, route: "native" });
    // Not a preference. NEP-141 refunds an unapplied amount to the transfer's sender,
    // which on this route is an Intents contract rather than the payer, so any excess
    // lands somewhere the payer cannot reach. Exact output keeps the excess at zero.
    expect(request.swapType).toBe("EXACT_OUTPUT");
    expect(request.amount).toBe("4250000000");
  });

  it("carries the invoice id to the contract on the native route", () => {
    const request = buildQuoteRequest({ ...ARGS, route: "native" });
    expect(request.customRecipientMsg).toBe('{"action":"pay","invoice_id":"7"}');
    expect(request.recipient).toBe("ileri.near");
    expect(request.recipientType).toBe("DESTINATION_CHAIN");
  });

  // On the relay route the money arrives as a plain transfer and our own account sends
  // the message afterwards, so asking 1Click to attach one would be meaningless.
  it("sends no message on the relay route", () => {
    const request = buildQuoteRequest({ ...ARGS, route: "relay" });
    expect(request.customRecipientMsg).toBeUndefined();
    expect("customRecipientMsg" in request).toBe(false);
  });

  it("names a refund address on the origin chain", () => {
    const request = buildQuoteRequest({ ...ARGS, route: "native" });
    expect(request.refundTo).toBe(ARGS.refundTo);
    expect(request.refundType).toBe("ORIGIN_CHAIN");
    expect(request.depositType).toBe("ORIGIN_CHAIN");
  });

  it("sends the deadline as ISO 8601", () => {
    const request = buildQuoteRequest({ ...ARGS, route: "native" });
    expect(request.deadline).toBe("2026-11-13T12:00:00.000Z");
  });

  it("quotes for real unless told to dry run", () => {
    expect(buildQuoteRequest({ ...ARGS, route: "native" }).dry).toBe(false);
    expect(buildQuoteRequest({ ...ARGS, route: "native", dry: true }).dry).toBe(true);
  });

  // A quote for nothing would return a deposit address that settles nothing, and the
  // payer would have sent money at an invoice that cannot take it.
  it("refuses to quote for zero or a non-amount", () => {
    expect(() => buildQuoteRequest({ ...ARGS, route: "native", unpaidAmount: "0" })).toThrow(
      OneClickError,
    );
    expect(() =>
      buildQuoteRequest({ ...ARGS, route: "native", unpaidAmount: "4250.00" }),
    ).toThrow(OneClickError);
    expect(() => buildQuoteRequest({ ...ARGS, route: "native", unpaidAmount: "" })).toThrow(
      OneClickError,
    );
  });

  // The id goes into a JSON message the contract parses, so anything that is not digits
  // has no business reaching it.
  it("refuses an invoice id that is not digits", () => {
    expect(() =>
      buildQuoteRequest({ ...ARGS, route: "native", invoiceId: '7","action":"buy' }),
    ).toThrow(OneClickError);
  });

  // Everything except the final hop has to be identical, or the relay fallback is a
  // second implementation to get wrong rather than a flag to flip.
  it("differs between the two routes only in the message", () => {
    const native = buildQuoteRequest({ ...ARGS, route: "native" });
    const relay = buildQuoteRequest({ ...ARGS, route: "relay" });
    const nativeRest: Record<string, unknown> = { ...native };
    delete nativeRest.customRecipientMsg;
    expect(relay).toEqual(nativeRest);
  });
});
