# Ileri Design System

Nov 11, 2026

The visual design lives on a canvas, which is the thing to look at before changing any
screen:

**https://claude.ai/artifact/7kqruxkTi5M477APXwrEcx**

Twelve artboards in four rows: foundations (design system, the NFT, the logo), the issuer's
flow, the client's flow, and the market. Three of them are interactive: the landing page's
story walkthrough, the NFT status stamp, and the pay page's chain selector.

This file is the part that has to survive without the canvas: the direction, the tokens and
the rules. Where this file and the canvas disagree, the canvas is newer and wins, and this
file should be corrected.

## The direction: bearer instrument

Ileri means promise. An invoice that pays whoever holds it is a promissory note, which is
the oldest financial object there is, so the design language is engraved security printing:
guilloche line work, serial numbers, warm banknote paper, an inked stamp for status.

One rule keeps that from becoming costume: **the document is engraved, the app around it is
a quiet ledger.** Security printing appears on the invoice itself. Navigation, tables and
forms stay plain and typographically tight, so the instrument is the only thing on the page
that shines.

Three principles, in the order they settle arguments:

1. **The sheet is the hero.** If a decoration is not on the instrument, it probably should
   not exist.
2. **Money is typeset, not styled.** Tabular figures, the token named every time, the
   unpaid balance always beside the total. A progress bar may follow a number, never
   replace it.
3. **Status is stamped.** State changes land as ink, slightly off square. One stamp per
   invoice, never two competing badges.

This also answers what the NFT is, which the blank metadata had left unanswered: the token
image **is** the instrument, generated from the token id alone. It carries the wordmark, the
serial, the contract id and the status stamp, and no names, no amounts and no line items, so
it can sit in a public wallet without leaking anything. That resolves the tension between
the `nfts` track wanting something visible and the privacy rules wanting nothing exposed.

## Colour

Ten tokens. Contrast ratios are against paper unless stated.

| Token | Hex | Role | Contrast |
| --- | --- | --- | --- |
| `paper` | `#F4F1E8` | App ground, warm banknote stock | ground |
| `sheet` | `#FBFAF5` | The instrument's own stock, a shade lighter than the desk | ground |
| `wash` | `#E9E4D6` | Table banding, inert fills, disabled | ground |
| `rule` | `#CEC6B2` | Every hairline and field border. Never for text | border only |
| `ink` | `#171A24` | Text and engraving | 14.9:1 |
| `ink-soft` | `#5A5E6B` | Secondary text, passes at 11px | 5.9:1 |
| `oxblood` | `#8A2B2B` | The seal, the issuer's hand, overdue, destructive | 6.4:1 |
| `verified` | `#1C5B40` | Paid, and only when `paid == amount` | 7.6:1 |
| `gold` | `#9C7A22` | Listed for sale. The market, and nothing else | 4.6:1 |
| `indigo` | `#2A3F7A` | Accepted, and money still crossing chains | 8.1:1 |

Rules that come with the palette:

- Colour belongs to **status**, not to the brand. The logo is never anything but ink or
  paper.
- Colours that must be told apart also differ in lightness. Overdue (oxblood) against
  rejected (ink) is the pair this matters for.
- `gold` only ever means for sale. If something is gold and not a listing, it is a bug.

## Type

Three families, all on Google Fonts, each with a close system fallback.

| Role | Face | Stack |
| --- | --- | --- |
| Display, amounts on the sheet | Instrument Serif | `'Instrument Serif', Georgia, 'Times New Roman', serif` |
| UI and body | Public Sans | `'Public Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif` |
| Serials, accounts, hashes, code | IBM Plex Mono | `'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace` |

Scale: display 68/0.95, title 30/1.15, heading 20/600, body 15/1.6, label 12.5/600 with
0.06em tracking, serial 13 mono with 0.14em tracking, amount 36/600.

Every figure that is money or a count carries `font-variant-numeric: tabular-nums`, so a
column lines up and a number does not jump as it updates. Two decimals are shown; the
contract's six live in the `title` attribute.

## Spacing, rules and corners

- Spacing: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Grid: twelve columns, 24px gutters, 80px margins at 1360, content capped at 1120. The
  sheet takes eight columns and the rail four.
- Hairline: 1px `rule`, separates rows. **Double rule**: 1px `ink`, 1px gap, 1px `ink`,
  closes a section, as on a certificate.
- **Comb edge**: `repeating-linear-gradient(90deg, rule 0 1px, transparent 1px 7px)` on the
  bottom of the sheet. It marks a stub, the edge you tear when a note is cashed or sold.
- Corners: **0px on documents**, 2px on controls, 999px on the account chip only. A
  promissory note has never had a rounded corner.

## The engraving

Both patterns are generated geometry, not stock art, and live as SVG beside the artboards.

- **Band**: nine woven sine lines at two frequencies,
  `y = mid + 0.30h·sin(f₁t + φ) + 0.14h·sin(f₂t − 1.7φ)`. Caps the sheet and every page
  header. Stretches to any width with `preserveAspectRatio="none"`.
- **Rosette**: two epitrochoids, seven and eleven petals. The seal, and the watermark
  behind the amount.

When these are built for real, seed the band phase and the petal count from the token id, so
every invoice looks individual while leaking nothing.

## Components

**The instrument** is one component used on five screens and as the token image. Full on the
invite page and the invoice page; reduced to a 120px stub in dashboard and market rows;
rendered from the token id alone for the NFT.

**Stamps**: sentence case, letter-spaced, double-ruled, rotated 1 to 3 degrees, with a
`stamp-press` scale-in when the status changes. Eight of them: issued (ink-soft), accepted
(indigo), partially paid (indigo dashed), paid (verified, heaviest), overdue (oxblood),
rejected (ink), cancelled (ink-soft dashed), listed for sale (gold).

**Buttons**: primary is ink filled, secondary is an ink hairline, destructive is an oxblood
hairline, gold is for listing, quiet is text with a rule underline. All at least 44px tall.
A busy button shows the hairline spinner and a label saying what is being waited on, since
almost every action here waits on a wallet window and that wait is seconds.

**Motion**: exactly two animations, and the list is closed. `stamp-press` when a status
lands, and `spin-hairline` on a busy control. Under reduced motion the stamp appears
without its press and the spinner becomes a static dot.

**Account chip**: a disc in the account's own derived colour plus the account id in mono, so
the same person looks the same on every screen.

## Logo

Three directions are on the canvas and **none is chosen yet**. The wordmark is Instrument
Serif either way; what is open is the mark beside it.

- **A, the stub.** A ruled note with the security wave across it and a torn comb foot. Axis:
  the document itself. Legible at 16px. The recommendation.
- **B, the hand-off.** Two notes, one passing in front of the other. Axis: it changes hands,
  which is the thing no other invoicing tool does.
- **C, the sealed note.** The guilloche seal with the note held inside it. Axis: an
  authenticated promise. Best at poster size, collapses to a grey ring at 16px, so it would
  need A as a fallback mark.

Whichever is chosen: clearspace of one comb-foot height, 16px minimum for the mark alone,
one colour only (ink on paper or paper on ink), never rotated, outlined, shadowed or set in
another face.

## Copy

The rules in `CLAUDE.md` govern and are not restated here, with one addition the design
depends on: **"Paid" is shown only when the contract's `paid` equals `amount`**, never from
a 1Click status or the database. Money in flight is indigo and says so in words.

## Still open

- Which logo direction ships, and then rolling it through every page header.
- The pay page's design covers both the native 1Click route and the relayer fallback. Which
  one it ends up documenting depends on the mainnet test, which is build order step 3.
- None of this is in `app/` yet. The canvas is the spec; the screens still carry the first
  pass.
