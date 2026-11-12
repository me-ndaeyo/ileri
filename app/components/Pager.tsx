import Link from "next/link";
import { pageHref, type Page } from "@/lib/paginate";

/**
 * Previous and next, as links.
 *
 * Links rather than buttons, so a page is a real URL: shareable, bookmarkable, and
 * working with the back button. It also means no client JavaScript, which keeps the
 * surrounding list a server component.
 *
 * `key` is the search parameter this pager owns, so the dashboard can page its two lists
 * without one resetting the other.
 */
export function Pager<T>({
  page,
  pathname,
  params,
  paramKey,
  noun,
}: {
  page: Page<T>;
  pathname: string;
  params: Readonly<Record<string, string | string[] | undefined>>;
  paramKey: string;
  /** What is being counted, singular. "invoice", "listing". */
  noun: string;
}) {
  // One page of results needs no pager, but the count is still worth stating.
  if (page.pages <= 1) {
    return page.total === 0 ? null : (
      <p className="mt-4 text-xs text-ink/60">
        {page.total} {page.total === 1 ? noun : `${noun}s`}
      </p>
    );
  }

  const first = (page.page - 1) * page.rows.length + 1;

  return (
    <nav
      className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-4"
      aria-label={`${noun} pages`}
    >
      <Step
        href={pageHref(pathname, params, paramKey, page.page - 1)}
        disabled={page.page === 1}
      >
        Previous
      </Step>
      <Step
        href={pageHref(pathname, params, paramKey, page.page + 1)}
        disabled={page.page === page.pages}
      >
        Next
      </Step>

      <span className="flex-1" />

      <p className="tabular text-xs text-ink/60">
        {first} to {first + page.rows.length - 1} of {page.total}
        <span className="sr-only">
          {" "}
          {noun}s, page {page.page} of {page.pages}
        </span>
      </p>

      {/* Only shown when it is actually true, because it is a limitation and not a
          footnote: past this many, the oldest are not reachable from here. */}
      {page.capped ? (
        <p className="basis-full text-xs text-ink/60">
          Showing the most recent {page.total}. Older ones than that are on chain but not
          listed here.
        </p>
      ) : null}
    </nav>
  );
}

function Step({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  // A disabled link is not a link. Rendered as plain text so it is not focusable and
  // cannot be followed, rather than an anchor with a click handler that refuses.
  if (disabled) {
    return (
      <span className="inline-flex min-h-11 items-center px-3 text-sm text-ink/40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center border border-rule px-3 text-sm hover:bg-paper"
    >
      {children}
    </Link>
  );
}
