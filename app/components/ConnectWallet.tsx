"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "@/lib/wallet";
import { Button } from "@/components/Button";

/**
 * Sign in and out.
 *
 * An action keeps one name through the flow, per the copy rules: the button says
 * "Connect wallet", and what comes back is the account, not a success message.
 */
export function ConnectWallet({
  accountId,
  compact = false,
}: {
  accountId: string | null;
  /** Sized for a nav rather than a page: a smaller button, and errors below it. */
  compact?: boolean;
}) {
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
        <span className="text-ink-soft">Signed in as</span>
        <span>{accountId}</span>
        <Button
          onClick={() => run(signOut)}
          busy={busy || pending ? "Signing out" : null}
          className="px-2 py-1"
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "relative flex flex-col items-end"
          : "flex flex-col items-start gap-2"
      }
    >
      <Button
        onClick={() => run(signIn)}
        busy={busy ? "Check your wallet" : pending ? "Reading your account" : null}
        tone="primary"
        size={compact ? "compact" : "default"}
      >
        Connect wallet
      </Button>
      {error ? (
        <p
          className={
            compact
              ? // Taken out of the flow in a nav, or an error would shove the row taller
                // and move everything else on the page down.
                "absolute top-full right-0 z-30 mt-1 max-w-[16rem] border border-stamp-red bg-sheet p-2 text-xs text-stamp-red"
              : "text-xs text-stamp-red"
          }
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
