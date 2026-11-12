import Link from "next/link";
import { AccountChip } from "@/components/AccountChip";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * The chrome every signed-in screen shares.
 *
 * Two layouts rather than one that wraps. On a wide screen it is a single sticky row. On a
 * phone that row had to wrap, which pushed the account and the sign out onto a second line
 * and ate a chunk of the viewport before any content appeared.
 *
 * So on a phone the top keeps only the wordmark, and everything you reach for moves to a
 * bar at the bottom: both tabs and the account. That is a better answer than putting only
 * the account down there, because a bottom bar is for the things you tap and the tabs are
 * the things you tap. It also puts them in thumb reach rather than at the far top corner.
 *
 * Both layouts are in the markup and swapped with a media query rather than measured in
 * JavaScript, so the right one is in the prerendered HTML and nothing shifts on hydration.
 *
 * It takes the account as a prop rather than reading the cookie itself, so a page can
 * render the frame statically and stream only the part that needs the request.
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
    <>
      <header className="sticky top-0 z-20 border-b border-rule bg-sheet">
        <div className="mx-auto flex w-full max-w-[1080px] items-center gap-x-7 px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="mark h-7 w-7 flex-none" aria-hidden="true" />
            <span className="font-serif text-base leading-none">Ileri</span>
          </Link>

          <nav className="hidden gap-5 text-sm sm:flex">
            <Tab href="/app" active={current === "invoices"}>
              Invoices
            </Tab>
            <Tab href="/market" active={current === "market"}>
              Market
            </Tab>
          </nav>

          <span className="flex-1" />

          <div className="hidden items-center gap-3 sm:flex">
            {accountId ? (
              <>
                <AccountChip accountId={accountId} />
                <SignOutButton />
              </>
            ) : (
              <span className="text-xs text-ink/60">Not connected</span>
            )}
          </div>

          {/* On a phone, sign out is the one thing up here beside the wordmark. It is
              rare and mildly destructive, so the far corner from the thumb is the right
              place for it, and the account id it signs out of is in the bottom bar where
              there is room to read it. */}
          {accountId ? (
            <SignOutButton className="sm:hidden" />
          ) : (
            <span className="text-xs text-ink/60 sm:hidden">Not connected</span>
          )}
        </div>
      </header>

      {/* The phone bar. `tabbar` is what the stylesheet keys the page's bottom padding
          off, so a page cannot forget to leave room for it. */}
      <nav
        className="tabbar fixed inset-x-0 bottom-0 z-20 border-t border-ink bg-sheet sm:hidden"
        aria-label="Sections"
      >
        <div className="flex items-stretch justify-between gap-3 px-4 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          <span className="flex items-stretch gap-1">
            <BottomTab href="/app" active={current === "invoices"}>
              Invoices
            </BottomTab>
            <BottomTab href="/market" active={current === "market"}>
              Market
            </BottomTab>
          </span>

          {accountId ? (
            /* Identity, not an action. Account ids run long, so this is allowed to clip
               rather than squeeze the tabs. */
            <span className="flex min-w-0 items-center">
              <AccountChip accountId={accountId} className="max-w-[11rem]" />
            </span>
          ) : null}
        </div>
      </nav>
    </>
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

/** The same tab, sized for a thumb rather than a cursor. */
function BottomTab({
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
      className={`flex min-h-11 items-center border-b-2 px-3 text-sm ${
        active ? "border-stamp-red" : "border-transparent text-ink/60"
      }`}
    >
      {children}
    </Link>
  );
}
