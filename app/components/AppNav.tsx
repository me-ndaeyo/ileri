import Link from "next/link";
import { AccountChip } from "@/components/AccountChip";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * The chrome every signed-in screen shares.
 *
 * It was missing entirely, which is why the inner pages read as a set of unrelated
 * documents: no wordmark, no way back, and no indication of which account you were
 * looking at. That last one matters more here than in most apps, because the same person
 * may hold two accounts and an invoice means something different to each.
 *
 * Deliberately not a client component and deliberately not given a sign-out button. It
 * takes the account as a prop so a page can render the frame statically and stream only
 * the part that needs the cookie.
 */
export function AppNav({
  accountId,
  current,
}: {
  accountId: string | null;
  /** Which tab to mark, if any. Absent on a page that belongs to no tab. */
  current?: "invoices" | "market";
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-sheet">
      <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-x-7 gap-y-3 px-5 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="mark h-7 w-7 flex-none" aria-hidden="true" />
          <span className="font-serif text-base leading-none">Ileri</span>
        </Link>

        <nav className="flex flex-wrap gap-5 text-sm">
          <Tab href="/app" active={current === "invoices"}>
            Invoices
          </Tab>
          <Tab href="/market" active={current === "market"}>
            Market
          </Tab>
        </nav>

        <span className="flex-1" />

        {accountId ? (
          <span className="flex items-center gap-3">
            <AccountChip accountId={accountId} />
            <SignOutButton />
          </span>
        ) : (
          <span className="text-xs text-ink/60">Not connected</span>
        )}
      </div>
    </header>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: "/app" | "/market";
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "border-b-2 border-stamp-red pb-0.5"
          : "border-b-2 border-transparent pb-0.5 text-ink/60 hover:text-ink"
      }
    >
      {children}
    </Link>
  );
}
