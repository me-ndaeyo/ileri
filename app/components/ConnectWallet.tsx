"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "@/lib/wallet";

/**
 * Sign in and out.
 *
 * An action keeps one name through the flow, per the copy rules: the button says
 * "Connect wallet", and what comes back is the account, not a success message.
 */
export function ConnectWallet({ accountId }: { accountId: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      // Re-render server components so they see the new session cookie.
      startTransition(() => router.refresh());
    } catch (cause) {
      // Say what happened and what to do, never a raw stack.
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (accountId) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <span className="text-ink/60">Signed in as</span>
        <span>{accountId}</span>
        <button
          type="button"
          onClick={() => run(signOut)}
          disabled={busy || pending}
          className="border border-rule px-2 py-1 hover:bg-paper disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => run(signIn)}
        disabled={busy || pending}
        className="border border-stamp-blue bg-stamp-blue px-4 py-2 text-sm text-sheet hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Check your wallet…" : "Connect wallet"}
      </button>
      {error ? <p className="text-xs text-stamp-red">{error}</p> : null}
    </div>
  );
}
