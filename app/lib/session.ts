/**
 * The session cookie.
 *
 * A signed, non-encrypted cookie holding only an account id and an expiry. It is signed
 * rather than encrypted because there is nothing secret in it: the account id is public
 * on chain. Signing is what stops somebody editing the cookie to become another account.
 *
 * Server-only.
 *
 * Holding a session proves somebody controlled that account's key at sign-in. It proves
 * nothing about their rights over any particular invoice, so every route touching private
 * data re-checks the role against the contract at that moment. A sold invoice stops being
 * visible to its old holder immediately, without waiting for a session to expire.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";

const COOKIE = "ileri_session";
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export interface Session {
  accountId: string;
  expiresAt: number;
}

function secret(): Buffer {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is not set. Generate one with: openssl rand -base64 32");
  }
  // A short secret would be brute-forceable, and a default would be catastrophic, so
  // refuse rather than accept a weak one.
  if (value.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return Buffer.from(value, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function serializeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Parse and verify. Returns `null` for anything not currently valid. */
export function parseSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  // Constant time, so a wrong signature cannot be narrowed down by timing.
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof session.accountId !== "string" || typeof session.expiresAt !== "number") {
      return null;
    }
    // Checked here as well as by the cookie's own expiry, because a cookie's lifetime is
    // enforced by the browser and a browser is not to be trusted on our behalf.
    if (session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function setSession(accountId: string): Promise<void> {
  const session: Session = { accountId, expiresAt: Date.now() + TWELVE_HOURS_MS };
  const store = await cookies();
  store.set(COOKIE, serializeSession(session), {
    httpOnly: true,
    // Lax rather than Strict: an invite link arrives from WhatsApp or email, and Strict
    // would drop the cookie on that first cross-site navigation.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TWELVE_HOURS_MS / 1000,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/**
 * The signed-in account, or `null`.
 *
 * `connection()` first, because verifying a session compares its expiry against the
 * clock, and Cache Components rightly refuses to run `Date.now()` while prerendering: a
 * timestamp baked into a static shell would be wrong for every later request. This says
 * "wait for a real request", so the caller must sit inside a `<Suspense>` boundary.
 */
export async function currentAccount(): Promise<string | null> {
  await connection();
  const store = await cookies();
  return parseSession(store.get(COOKIE)?.value)?.accountId ?? null;
}
