/**
 * Paging for the lists read from the contract.
 *
 * The contract's own views take `from_index` and `limit`, which is real pagination, but
 * they return **oldest first** and there is no view giving a count per account. Paging
 * forward through that would land somebody on their oldest invoices and put this week's
 * work three pages in, which is the wrong way round for a dashboard.
 *
 * So the app asks for one window up to `CAP`, reverses it to newest first, and pages
 * within that. One RPC call, exact page numbers, and the order people expect.
 *
 * The trade is explicit: beyond `CAP` invoices for one account, the oldest stop being
 * reachable. That is the right trade at this size and the wrong one at ten times it, and
 * fixing it properly needs a count view on the contract so the window can be taken from
 * the end instead. Written down rather than discovered later.
 */

/** Matches the ceiling `get_listings` already enforces, so one page is always one call. */
export const CAP = 200;

export interface Page<T> {
  rows: T[];
  /** 1-based, clamped into range. */
  page: number;
  pages: number;
  total: number;
  /** True when the account has more than `CAP` and the tail is unreachable. */
  capped: boolean;
}

/**
 * Newest first, then the window for `page`.
 *
 * `page` comes from a URL, so it is whatever somebody typed: a word, a negative, a number
 * past the end. All of those clamp to a real page rather than erroring or rendering an
 * empty list, because an empty list reads as "you have nothing" and that would be a lie.
 */
export function paginate<T>(
  items: readonly T[],
  page: unknown,
  perPage: number,
): Page<T> {
  if (perPage < 1) throw new Error(`perPage must be at least 1, got ${perPage}`);

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const asked = typeof page === "string" || typeof page === "number" ? Number(page) : 1;
  const current = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), pages) : 1;

  const start = (current - 1) * perPage;
  // `toReversed` leaves the caller's array alone; reversing in place would mutate a list
  // another part of the page is also reading.
  const rows = items.toReversed().slice(start, start + perPage);

  return { rows, page: current, pages, total, capped: total >= CAP };
}

/**
 * The page's URL, keeping every other parameter.
 *
 * The dashboard pages two lists independently, so one pager must not reset the other.
 */
export function pageHref(
  pathname: string,
  params: Readonly<Record<string, string | string[] | undefined>>,
  key: string,
  page: number,
): string {
  const next = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === key || value === undefined) continue;
    // A repeated parameter arrives as an array. Keep the first and drop the rest: there
    // is no sensible meaning for two page numbers on one list.
    next.set(name, Array.isArray(value) ? (value[0] ?? "") : value);
  }
  if (page > 1) next.set(key, String(page));
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
