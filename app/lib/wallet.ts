"use client";

/**
 * The wallet, in the browser.
 *
 * One `NearConnector` for the page's lifetime, created lazily so importing this module
 * does not start loading wallet machinery on pages that never need it.
 *
 * Checked against @hot-labs/near-connect 0.12.0 rather than assumed: the entry point is
 * `NearConnector`, and `signInAndSignMessage` returns accounts that already carry a
 * `SignedMessage`, so connecting and proving control happen in one wallet prompt instead
 * of two.
 */

import { NearConnector } from "@hot-labs/near-connect";
import { publicEnv } from "./env";

/** Must match the `recipient` the server binds into the NEP-413 payload. */
export const RECIPIENT = "ileri";

let connector: NearConnector | undefined;

export function getConnector(): NearConnector {
  connector ??= new NearConnector({ network: publicEnv.network });
  return connector;
}

export interface SignInResult {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  message: string;
}

/**
 * Connect a wallet and sign in.
 *
 * The server chooses the nonce and the server verifies the result, so nothing here is
 * trusted: this function only carries bytes between the wallet and the API.
 */
export async function signIn(): Promise<SignInResult> {
  // Ask for the challenge first. If the user abandons the wallet prompt the nonce simply
  // expires unused, which costs nothing.
  const challenge = await fetch("/api/auth/challenge", { method: "POST" });
  if (!challenge.ok) throw new Error("Could not start sign in");
  const { nonce, message, recipient } = (await challenge.json()) as {
    nonce: string;
    message: string;
    recipient: string;
  };

  const wallet = await getConnector().connect();
  const accounts = await wallet.signInAndSignMessage({
    messageParams: {
      message,
      recipient,
      // The server's nonce, as the 32 raw bytes NEP-413 requires.
      nonce: hexToBytes(nonce),
    },
  });

  const account = accounts[0];
  if (!account?.signedMessage) {
    throw new Error("That wallet did not return a signed message");
  }

  const verify = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId: account.signedMessage.accountId,
      publicKey: account.signedMessage.publicKey,
      signature: account.signedMessage.signature,
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

  return {
    accountId: account.signedMessage.accountId,
    publicKey: account.signedMessage.publicKey,
    signature: account.signedMessage.signature,
    nonce,
    message,
  };
}

export async function signOut(): Promise<void> {
  // Clear our session first. If the wallet disconnect fails the user is still signed
  // out of the app, which is the half that matters.
  await fetch("/api/auth/logout", { method: "POST" });
  try {
    const { wallet } = await getConnector().getConnectedWallet();
    await getConnector().disconnect(wallet);
  } catch {
    // No wallet connected, or it refused. Either way the session is gone.
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
