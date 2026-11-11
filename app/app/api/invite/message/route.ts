import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { inviteMessage } from "@/lib/near";

/**
 * The exact message the contract will verify for an accept or reject.
 *
 * Proxied from the contract's own `invite_message` view rather than rebuilt in the
 * browser. The format binds the contract id, invoice id, caller and action, and a local
 * copy that drifted would make every accept fail with no visible cause. Asking the
 * contract means there is one definition of the truth.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const account = url.searchParams.get("account");
  const action = url.searchParams.get("action");

  if (!id || !/^\d+$/.test(id) || !account || (action !== "accept" && action !== "reject")) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      message: await inviteMessage(publicEnv.contractId, id, account, action),
    });
  } catch (error) {
    console.error("invite/message failed", {
      invoice: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not prepare the signature" }, { status: 500 });
  }
}
