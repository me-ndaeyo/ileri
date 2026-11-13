import { describe, expect, it } from "vitest";
import { CAP, pageHref, paginate } from "@/lib/paginate";

const items = [1, 2, 3, 4, 5, 6, 7];

describe("paginate", () => {
  it("puts the newest first", () => {
    // The contract returns oldest first, and a dashboard that opens on last month's
    // invoices is the wrong way round.
    expect(paginate(items, 1, 3).rows).toEqual([7, 6, 5]);
    expect(paginate(items, 2, 3).rows).toEqual([4, 3, 2]);
    expect(paginate(items, 3, 3).rows).toEqual([1]);
  });

  it("counts the pages", () => {
    const page = paginate(items, 1, 3);
    expect(page.pages).toBe(3);
    expect(page.total).toBe(7);
  });

  // The page number comes from a URL, so it is whatever somebody typed. Every one of
  // these has to land on a real page: an empty list reads as "you have nothing", which
  // would be a lie.
  it("clamps anything a URL can carry", () => {
    for (const asked of [0, -4, 99, "99", "abc", "", null, undefined, NaN, 1.7]) {
      const page = paginate(items, asked, 3);
      expect(page.page).toBeGreaterThanOrEqual(1);
      expect(page.page).toBeLessThanOrEqual(3);
      expect(page.rows.length).toBeGreaterThan(0);
    }
    expect(paginate(items, 99, 3).page).toBe(3);
    expect(paginate(items, -4, 3).page).toBe(1);
    expect(paginate(items, "abc", 3).page).toBe(1);
    // Truncated, not rounded: page 1.7 is page 1, never page 2.
    expect(paginate(items, 1.7, 3).page).toBe(1);
  });

  it("is one empty page when there is nothing", () => {
    const page = paginate([], 1, 8);
    expect(page.rows).toEqual([]);
    expect(page.pages).toBe(1);
    expect(page.total).toBe(0);
  });

  it("leaves the caller's array alone", () => {
    const original = [1, 2, 3];
    paginate(original, 1, 2);
    expect(original).toEqual([1, 2, 3]);
  });

  it("says when the window is full and the tail is out of reach", () => {
    expect(paginate(items, 1, 3).capped).toBe(false);
    expect(paginate(Array.from({ length: CAP }, (_, i) => i), 1, 10).capped).toBe(true);
  });

  it("refuses a page size of nothing", () => {
    expect(() => paginate(items, 1, 0)).toThrow();
  });
});

describe("pageHref", () => {
  it("drops the parameter on page one, so the plain URL is the first page", () => {
    expect(pageHref("/app", {}, "sent", 1)).toBe("/app");
    expect(pageHref("/app", {}, "sent", 2)).toBe("/app?sent=2");
  });

  // The dashboard pages two lists, and moving one must not reset the other.
  it("keeps the other list's page", () => {
    expect(pageHref("/app", { billed: "3" }, "sent", 2)).toBe("/app?billed=3&sent=2");
    expect(pageHref("/app", { billed: "3", sent: "5" }, "sent", 1)).toBe("/app?billed=3");
  });

  it("keeps a repeated parameter down to one value", () => {
    expect(pageHref("/app", { billed: ["3", "9"] }, "sent", 2)).toBe("/app?billed=3&sent=2");
  });
});
