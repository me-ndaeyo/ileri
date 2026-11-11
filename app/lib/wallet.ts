"use client";

/**
 * The wallet, in the browser.
 *
 * One `NearConnector` for the page's lifetime, created lazily so importing this module
 * does not start loading wallet machinery on pages that never need it.
 *
 * The shape of this was checked against @hot-labs/near-connect 0.12.0, and it is not
 * what it first looks like. `signMessageParams` is passed to `connect`, not to a
 * separate call: the connector then filters the wallet picker down to wallets that
 * support `signInAndSignMessage`, and the signed message comes back through the
 * `wallet:signInAndSignMessage` **event** rather than as a return value. Calling
 * `wallet.signInAndSignMessage()` after a plain `connect()` leaves the picker open
 * forever, because the wallet has already finished and nothing is listening.
 */

import { NearConnector } from "@hot-labs/near-connect";
import type { AccountWithSignedMessage } from "@hot-labs/near-connect";
import { publicEnv } from "./env";

/** Must match the `recipient` the server binds into the NEP-413 payload. */
export const RECIPIENT = "ileri";

/** How long to wait for someone to approve in their wallet before giving up. */
const WALLET_TIMEOUT_MS = 180_000;

let connector: NearConnector | undefined;

export function getConnector(): NearConnector {
  connector ??= new NearConnector({ network: publicEnv.network });
  return connector;
}

export interface SignInResult {
  accountId: string;
}

/**
 * Connect a wallet and sign in.
 *
 * The server chooses the nonce and the server verifies the result, so nothing here is
 * trusted: this only carries bytes between the wallet and the API.
 */
export async function signIn(): Promise<SignInResult> {
  // Ask for the challenge first. If the user abandons the wallet prompt, the nonce
  // simply expires unused, which costs nothing.
  const challenge = await fetch("/api/auth/challenge", { method: "POST" });
  if (!challenge.ok) throw new Error("Could not start sign in");
  const { nonce, message, recipient } = (await challenge.json()) as {
    nonce: string;
    message: string;
    recipient: string;
  };

  const instance = getConnector();

  // Listen before connecting. The event can fire before `connect` resolves, and
  // registering afterwards would miss it.
  const signed = new Promise<AccountWithSignedMessage>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for your wallet")),
      WALLET_TIMEOUT_MS,
    );

    instance.once("wallet:signInAndSignMessage", ({ accounts, success }) => {
      clearTimeout(timer);
      const account = accounts?.[0];
      if (!success || !account?.signedMessage) {
        reject(new Error("Your wallet did not sign the message"));
        return;
      }
      resolve(account);
    });
  });

  // Passing `signMessageParams` is what makes this one prompt rather than two, and
  // limits the picker to wallets that can do it.
  await instance.connect({
    signMessageParams: { message, recipient, nonce: hexToBytes(nonce) },
  });

  const { signedMessage } = await signed;

  const verify = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId: signedMessage.accountId,
      publicKey: signedMessage.publicKey,
      signature: signedMessage.signature,
      nonce,
      message,
    }),
  });

  if (!verify.ok) {
    const { error } = (await verify.json().catch(() => ({ error: null }))) as {
      error: string | null;
    };
    throw new Error(error ?? "Sign in failed");
  }

  return { accountId: signedMessage.accountId };
}

export async function signOut(): Promise<void> {
  // Clear our session first. If the wallet refuses to disconnect, the user is still
  // signed out of the app, which is the half that matters.
  await fetch("/api/auth/logout", { method: "POST" });
  try {
    const { wallet } = await getConnector().getConnectedWallet();
    await getConnector().disconnect(wallet);
  } catch {
    // No wallet connected, or it declined. Either way the session is gone.
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Send a function call through the connected wallet.
 *
 * Actions use near-connect's own `ConnectorAction` shape, a plain object, rather than
 * `@near-js/transactions`'s `Action`. The latter is the type the signature advertises but
 * the package is not even resolvable here, and a plain object needs no dependency to
 * build.
 */
export async function callContract({
  receiverId,
  methodName,
  args,
  gas = "100000000000000", // 100 Tgas
  deposit = "0",
}: {
  receiverId: string;
  methodName: string;
  args: object;
  gas?: string;
  deposit?: string;
}): Promise<unknown> {
  const { wallet } = await getConnector().getConnectedWallet();
  return wallet.signAndSendTransaction({
    receiverId,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit } }],
  });
}

/**
 * Pull the returned value out of a transaction outcome.
 *
 * `create_invoice` returns the new id, and the only place it appears is base64 in the
 * final execution status. Reading it from the outcome avoids a follow-up view call that
 * could race the indexer.
 */
export function returnedValue(outcome: unknown): string | null {
  const status = (outcome as { status?: { SuccessValue?: string } } | undefined)?.status;
  if (!status?.SuccessValue) return null;
  try {
    // Base64 of the JSON the method returned, so `"7"` arrives with its quotes.
    return JSON.parse(atob(status.SuccessValue)) as string;
  } catch {
    return null;
  }
}
