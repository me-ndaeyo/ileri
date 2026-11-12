"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/wallet";

/**
 * Disconnect the wallet and end the session.
 *
 * This had no home for a while, which made the app unusable for the thing people
 * actually do with it: holding two accounts and needing to act as each in turn. An issuer
 * who wanted to open their own invite link as the client had no way to stop being the
 * issuer. `signOut` existed and worked; nothing called it.
 *
 * It lives beside the account it signs out, in the nav and on the invite page, rather
 * than in a menu, because switching accounts here is a normal thing to do rather than a
 * rare one.
 */
export function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      await signOut();
      // Re-render the server components so they see the cleared cookie.
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out");
    } finally {
      setBusy(false);
    }
  }

  const waiting = busy || pending;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={waiting}
        aria-busy={waiting || undefined}
        className={`min-h-11 px-1 text-xs text-ink/60 underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50 ${className}`}
      >
        {waiting ? (
          <span className="inline-flex items-center gap-2">
            <span className="spinner" aria-hidden="true" />
            Signing out
          </span>
        ) : (
          "Sign out"
        )}
      </button>
      {error ? <span className="text-xs text-stamp-red">{error}</span> : null}
    </span>
  );
}
