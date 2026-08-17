# M21 — Responsive Mobile-First Frontend: Kickoff Package

**Milestone:** M21 (frontend) — **Phase A foundation complete; Phase B.1 POS `/sales/new` complete and accepted; Phase B.2 sales list + detail + OWNER void flow complete and committed; Phase C.1 products & stock frontend complete and committed; Phase C.2 customers & payments frontend complete and committed**
**Date:** 15 Aug 2026 (updated 17 Aug 2026)
**Companion decision record:** [`business-decisions.md`](business-decisions.md) → D21
**Consumed backend:** all endpoints listed in [`README.md`](../README.md) (D1–D20)
**Primary user:** a shop owner operating from a smartphone on the shop floor

This document is the frontend kickoff package. It specifies the complete
responsive **information architecture** and a **page-by-page wireframe
specification** for desktop, tablet, and — in most detail — mobile. It defines
the *what* and the *layout*; implementation order and acceptance live in
[§13](#13-implementation-order).

---

## 1. Goals

1. **The shop owner's phone is a first-class client.** Every workflow a
   counter needs must be completable on a phone held in one hand, using a
   thumb, without zooming or horizontal scrolling.
2. **Record a sale in < 15 seconds.** Product search → quantity → payment type →
   save. The sale is the most frequent act in the shop.
3. **Stock and money stay simple.** Damage/correction, customer credit,
   supplier payouts, and the wallet are each one clear screen with one clear
   action.
4. **Tables and reports transform, never shrink.** Dense data becomes cards on
   mobile, a card grid on tablet, and full tables on desktop — with the same
   information in every size.
5. **The backend stays the single source of truth.** No business rule, no
   money math, no authorization logic moves into the frontend. The frontend
   calls `/api/*` and renders.

## 2. Non-goals (explicitly out of scope for M21)

- No barcode scanning, no offline/PWA cache, no native app.
- No new backend endpoints, no new business rules, no schema change.
- No charts/dashboards beyond the existing report payloads (D7).
- No wallet deposit/withdrawal form, no day-close, no low-stock alert, no
  per-customer sales history — all deferred to the backend backlog (Q1/Q2/Q3/Q5).
- No edit-in-place for historical transactions: corrections happen through
  the void flow (D18) exactly as the backend already supports.

## 3. Persona & context

| | |
| --- | --- |
| **Primary persona** | Shop owner (OWNER) — owns the business, is the accountant, uses an Android phone (often low-end, ~5–6" screen, possibly a data-limited connection). |
| **Secondary persona** | Counter cashier (CASHIER) — records sales and takes payments all day; never sees purchases, suppliers, wallet, or users (D9.3). |
| **Device context** | Mobile-first: portrait phone on a busy counter, one-handed, possibly dusty, screen glare. Tablet and desktop are used for big-picture reporting and master-data entry. |
| **Connection** | Same-origin web app; existing Better Auth session cookie (D9.5); no CORS (F-11). Session is 12 h with 6 h sliding renewal. |

**Implications carried through this spec:**

- Every tap target ≥ 44×44 px (48 px preferred); primary action bottom-anchored.
- No hover-dependent functionality.
- Server-side rendering for first paint, small client islands for the fast
  interactions (search-as-you-type, keypad, cart).
- Offline is not a goal, so a slow request shows a spinner + retry, never a
  stale optimistic write that could double-post.

## 4. Design principles

1. **One thumb, no scroll for the critical path.** On mobile the primary CTA
   is always reachable at the bottom of the viewport.
2. **Look up, act once.** Search is the universal entry point for products,
   customers, and suppliers.
3. **Never hide state.** Stock level, signed balances (D4), VOIDED badges
   (D18.9), and payment type are always visible on the record's card.
4. **Numbers are exact.** Rupees with thousands separators; negative balances
   are signed and color-coded; no truncation of money.
5. **The API's own words.** Field-level errors copy the API's `{ message }`
   verbatim; no second interpretation layer.
6. **Role decides what exists.** A CASHIER's menu contains no OWNER screens at
   all (D21.7) — not greyed-out buttons.

## 5. Information architecture

### 5.1 Sitemap

```
/sign-in                      Sign in (username + password)
/                             Home — today's snapshot + quick actions
/sales/new                    New sale (fast entry)           [CASHIER+]
/sales                        Sales list (paged, filter by payment type)
/sales/[id]                   Sale detail (+ void, OWNER)
/products                     Products list (search + category filter)
/products/new                 New product                     [OWNER]
/products/[id]                Product detail
/stock/movements              Stock movements ledger (filter reason/product)
/stock/adjust                 Stock adjustment (DAMAGE | CORRECTION) [CASHIER+]
/customers                    Customers list (search)
/customers/new                New customer                    [CASHIER+]
/customers/[id]               Customer detail (signed balance, payments)
/customers/[id]/pay           Receive payment                 [CASHIER+]
/suppliers                    Suppliers list (search)
/suppliers/new                New supplier                    [OWNER]
/suppliers/[id]               Supplier detail (balance, purchases, payments)
/suppliers/[id]/pay           Pay supplier                    [OWNER]
/purchases                    Purchases list                  [OWNER]
/purchases/new                New purchase                    [OWNER]
/purchases/[id]               Purchase detail (+ void, OWNER) [OWNER]
/reports                      Reports hub (role-filtered)
/reports/sales                Sales report (+ CSV/JSON export)
/reports/purchases            Purchases report                [OWNER]
/reports/stock                Stock report
/reports/customers            Customers report                [OWNER]
/reports/suppliers            Suppliers report                [OWNER]
/reports/wallet               Wallet report                   [OWNER]
/users                        User management                 [OWNER]
/settings                     Profile, sign out
```

Brackets are the D9.3 role gate: unmarked routes are visible to both roles.

### 5.2 Navigation model by breakpoint

| Breakpoint | Width | Navigation |
| --- | --- | --- |
| **Mobile** | < 768 px | Bottom tab bar: **Home · Sell · Stock · Customers · More**. "More" opens a bottom sheet with the rest (Sales, Reports, Suppliers, Purchases, Users, Settings). |
| **Tablet** | 768–1199 px | Left icon rail (48 px icons + label on wide tablets), content beside it; same top destinations plus a collapsible "More". |
| **Desktop** | ≥ 1200 px | Persistent left sidebar (all destinations, role-filtered), top bar with page title + user menu. |

The five mobile tabs map to the five daily habits:

| Tab | Content | Role |
| --- | --- | --- |
| Home | Today's sales total (shop-local), wallet balance (OWNER, read-only), quick actions | both |
| Sell | Fast sales entry (`/sales/new`) | CASHIER+ |
| Stock | Movements list; big "Adjust" button | CASHIER+ |
| Customers | Customers list; "Receive payment" reachable per row | CASHIER+ |
| More | Sales list, Reports, Suppliers, Purchases (OWNER), Users (OWNER), Settings | both |

### 5.3 Role matrix applied to the shell (D9.3 / D21.7)

| Screen | CASHIER | OWNER |
| --- | :---: | :---: |
| Home, New Sale, Sales list/detail | ✅ | ✅ |
| Products list/detail, Product new | view ✅ / create ❌ | ✅ |
| Stock movements, Stock adjust | ✅ | ✅ |
| Customers list/new/detail, Receive payment | ✅ | ✅ |
| Suppliers list/detail | view ✅ / create ❌ | ✅ |
| Suppliers new, Pay supplier | ❌ | ✅ |
| Purchases list/new/detail | ❌ | ✅ |
| Sales + Stock reports | ✅ | ✅ |
| Purchases/Customers/Suppliers/Wallet reports | ❌ | ✅ |
| Users, Settings (management) | ❌ | ✅ |
| Voids (any) | ❌ | ✅ |

## 6. Global design tokens

| Token | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| Min touch target | 44×44 px (48 preferred) | 44×44 px | 40×40 px |
| Body text | 16 px | 16 px | 15 px |
| Screen gutter | 16 px | 24 px | 32 px |
| Bottom tab bar | 64 px tall | — | — |
| Sidebar | — | 72 px (rail) | 240 px (full) |
| Card corner radius | 12 px | 12 px | 8 px |
| Primary CTA | full-width, bottom-sticky | full-width | inline, top-right |

Color semantics (fixed, not dark-mode dependent for money meanings):

- **Green** — positive/in-stock/prepaid (customer negative `balanceOwed`, D4).
- **Red** — negative/owed danger. **No low-stock color in M21** (Q3): there is
  no threshold, so no amber low-stock state exists on any screen.
- **Amber** — pending/rate-limited only (no low-stock use in M21).
- **Grey strike** — VOIDED badge (D18.9).

Money is always rendered in rupees with thousands separators (the API's wire
format, D11): e.g. `रू 12,340.50`. `-120.00` shows as `रू -120.00` in red with
the D4 "prepaid" label when it is a customer balance.

### Typography (D23.1 — approved 16 Aug 2026)

Latin UI/brand face is **Plus Jakarta Sans** (Geist retired); **Noto Sans
Devanagari** covers Nepali shop data and the rupee sign रू (U+0930 U+0942).
Stacks in `app/globals.css` `@theme`:

| Stack | Faces |
| --- | --- |
| `--font-sans` (body) | Plus Jakarta Sans → Noto Sans Devanagari → `ui-sans-serif, system-ui, sans-serif` |
| `--font-heading` | Plus Jakarta Sans → Noto Sans Devanagari |
| `--font-nepali` | Noto Sans Devanagari |
| `--font-mono` | system `ui-monospace, SFMono-Regular, Menlo, Consolas` (technical IDs only) |

Glyphs fall through the stack, so Devanagari text and `रू` render via Noto Sans
Devanagari wherever they appear inside Plus Jakarta Sans copy.

### Color tokens (D23.2 — approved 16 Aug 2026; primary adjusted to `#2869d9`)

Restrained ERP palette: **one** primary brand/action blue (`#2869d9`; hover
`#2569d1`; tint `#eaf3ff`; foreground `#ffffff`), cool-neutral surfaces, and
three semantic pairs (success / warning / destructive). Color is
spent only on the primary CTA, the active navigation state, and semantic
status — never on decorative cards. **No page-specific colors**: every screen
uses only the tokens below (single source: `app/globals.css`). Money-color
semantics from the list above stay fixed and are not dark-mode dependent.
*The PM's originally requested brand blue `#3080f0` failed WCAG AA with white
text (3.84:1 < 4.5:1) and on the tint (3.43:1); PM approved `#2869d9`, which
passes every pair (see the contrast table).*

| Token | Light (OKLCh) | Light (hex) | Dark (OKLCh) | Dark (hex) | Use |
| --- | --- | --- | --- | --- | --- |
| `--background` | `oklch(0.985 0.002 260)` | `#f9fafb` | `oklch(0.17 0.012 260)` | `#0c1015` | page surface |
| `--foreground` | `oklch(0.2 0.02 260)` | `#11161f` | `oklch(0.95 0.005 260)` | `#eceff2` | primary text |
| `--card` / `--popover` | `oklch(1 0 0)` | `#ffffff` | `oklch(0.21 0.012 260)` | `#15181e` | card / popover surface |
| `--primary` | `oklch(0.5447 0.1844 260.6)` | `#2869d9` | `oklch(0.63 0.13 262)` | `#5d87d7` | brand/action: primary CTA, active nav text, focus ring, links |
| `--primary-hover` | `oklch(0.538 0.1746 259.2)` | `#2569d1` | `oklch(0.69 0.12 262)` | `#729be6` | hover/active state of primary surfaces |
| `--primary-foreground` | `oklch(1 0 0)` | `#ffffff` | `oklch(0.15 0.02 260)` | `#070b14` | text on primary |
| `--secondary` | `oklch(0.95 0.005 260)` | `#eceff2` | `oklch(0.26 0.012 260)` | `#21242a` | secondary button surface |
| `--secondary-foreground` | `oklch(0.28 0.02 260)` | `#232933` | `oklch(0.92 0.006 260)` | `#e2e5e9` | text on secondary |
| `--muted` | `oklch(0.96 0.004 260)` | `#f0f2f4` | `oklch(0.26 0.012 260)` | `#21242a` | subtle surface (badges, hover) |
| `--muted-foreground` | `oklch(0.47 0.018 260)` | `#555b65` | `oklch(0.72 0.015 260)` | `#9fa5ae` | secondary/helper text |
| `--accent` | `oklch(0.9609 0.0188 255.5)` | `#eaf3ff` | `oklch(0.28 0.02 262)` | `#232933` | highlighted surface (primary tint) |
| `--accent-foreground` | `oklch(0.5447 0.1844 260.6)` | `#2869d9` | `oklch(0.78 0.05 262)` | `#a6b8d8` | text on accent |
| `--destructive` | `oklch(0.55 0.19 25)` | `#c92f33` | `oklch(0.56 0.18 25)` | `#c8393a` | destructive action / danger |
| `--destructive-foreground` | `oklch(0.985 0 0)` | `#fafafa` | `oklch(0.97 0.005 0)` | `#f8f4f5` | text on destructive |
| `--success` | `oklch(0.52 0.13 165)` | `#007f56` | `oklch(0.62 0.11 165)` | `#359b75` | positive / in-stock / prepaid |
| `--success-foreground` | `oklch(0.985 0 0)` | `#fafafa` | `oklch(0.15 0.02 160)` | `#040e08` | text on success |
| `--warning` | `oklch(0.82 0.14 80)` | `#f3b94c` | `oklch(0.72 0.13 80)` | `#cf9a35` | pending / rate-limited only |
| `--warning-foreground` | `oklch(0.34 0.09 55)` | `#5a2800` | `oklch(0.25 0.08 55)` | `#3d1300` | text on warning (dark-on-amber) |
| `--border` | `oklch(0.9 0.005 260)` | `#dcdee1` | `oklch(1 0 0 / 10%)` | — | hairlines, dividers |
| `--input` | `oklch(0.645 0.016 260)` | `#888e98` | `oklch(1 0 0 / 15%)` | — | input/control boundary (≥3:1 vs surface) |
| `--ring` | `oklch(0.5447 0.1844 260.6)` | `#2869d9` | `oklch(0.63 0.13 262)` | `#5d87d7` | focus ring (== primary) |
| `--sidebar` | `oklch(0.97 0.004 260)` | `#f3f5f8` | `oklch(0.19 0.012 260)` | `#111419` | navigation surface |
| `--sidebar-foreground` | `oklch(0.2 0.02 260)` | `#11161f` | `oklch(0.95 0.005 260)` | `#eceff2` | nav text |
| `--sidebar-accent` | `oklch(0.9609 0.0188 255.5)` | `#eaf3ff` | `oklch(0.25 0.02 262)` | `#1c222b` | active nav item bg (subtle primary tint) |
| `--sidebar-accent-foreground` | `oklch(0.5447 0.1844 260.6)` | `#2869d9` | `oklch(0.78 0.05 262)` | `#a6b8d8` | active nav item text |
| `--sidebar-primary` | `oklch(0.5447 0.1844 260.6)` | `#2869d9` | `oklch(0.63 0.13 262)` | `#5d87d7` | nav primary element (== primary) |
| `--sidebar-primary-foreground` | `oklch(1 0 0)` | `#ffffff` | `oklch(0.15 0.02 260)` | `#070b14` | text on nav primary |
| `--sidebar-border` / `--sidebar-ring` | as `--border` / `--ring` | — | — | — | nav hairlines / focus |

Alpha borders in dark mode (`--border`, `--input`) composite over their
surface; they are shown in OKLCh form only.

**Design rules (apply to every M21 screen):**

1. `--primary` is reserved for: the primary CTA, the active navigation state
   (text + a very light `--sidebar-accent`/`--accent` tint background), focus
   rings, and inline links. Nothing else.
2. Navigation is neutral (`--sidebar`/`--sidebar-foreground`); only the active
   item carries the subtle primary tint.
3. Cards are neutral (`--card` on `--background`); semantic color is for
   status chips / badges / buttons, not card backgrounds.
4. Semantic meanings are fixed (green = positive/in-stock/prepaid, red =
   negative/owed danger, amber = pending/rate-limited only, grey strike =
   VOIDED) and never change with theme.
5. Text pairs must keep WCAG AA (≥4.5:1); control boundaries ≥3:1 — verified
   in the table below and re-verified whenever tokens change.

**WCAG AA contrast verification (computed from the OKLCh tokens above):**

| Pair (light) | Ratio | Pair (dark) | Ratio |
| --- | --- | --- | --- |
| `foreground` / `background` | 17.34:1 | `foreground` / `background` | 16.53:1 |
| `foreground` / `card` | 18.11:1 | `foreground` / `card` | 15.31:1 |
| `primary-foreground` / `primary` | 5.11:1 | `primary-foreground` / `primary` | 5.56:1 |
| `primary-foreground` / `primary-hover` | 5.22:1 | `primary-foreground` / `primary-hover` | 7.04:1 |
| `secondary-foreground` / `secondary` | 12.61:1 | `secondary-foreground` / `secondary` | 12.26:1 |
| `muted-foreground` / `background` | 6.54:1 | `muted-foreground` / `background` | 7.71:1 |
| `muted-foreground` / `card` | 6.82:1 | `muted-foreground` / `card` | 7.14:1 |
| `accent-foreground` / `accent` | 4.56:1 | `accent-foreground` / `accent` | 7.29:1 |
| `destructive-foreground` / `destructive` | 5.12:1 | `destructive-foreground` / `destructive` | 4.66:1 |
| `success-foreground` / `success` | 4.81:1 | `success-foreground` / `success` | 5.68:1 |
| `warning-foreground` / `warning` | 6.83:1 | `warning-foreground` / `warning` | 6.47:1 |
| `sidebar-foreground` / `sidebar` | 16.60:1 | `sidebar-foreground` / `sidebar` | 15.96:1 |
| `sidebar-accent-foreground` / `sidebar-accent` | 4.56:1 | `sidebar-accent-foreground` / `sidebar-accent` | 7.99:1 |
| `input` / `background` (UI ≥3:1) | 3.16:1 | `input` / `background` (UI ≥3:1) | 19.12:1 |
| `ring` / `background` (UI ≥3:1) | 4.89:1 | `ring` / `background` (UI ≥3:1) | 5.40:1 |

## 7. Responsive transformation rules (the "never shrink" rules)

These rules are **global** and apply to every list/report page. They are the
single answer to "how do tables work on mobile?"

1. **Row → card.** On mobile, each list record becomes a card: the two most
   important fields are the title + subtitle; the rest are labeled lines inside
   the card; the whole card is a tap target. No horizontal scroll ever.
2. **Table → card grid.** On tablet, cards flow into a 2-column grid.
3. **Real table.** On desktop (≥ 1200 px), a real `<table>` with sticky header,
   row hover, and the pagination footer.
4. **Column priority.** Any table section that must exist on mobile shows at
   most **4 primary fields** as a card; secondary fields live behind the
   detail. Reports on mobile show summary tiles first (always), then sections
   as collapsible card groups.
5. **Pagination.** Cursor pagination (D12) renders as "Load more" on mobile
   and "Prev / Next" + page count on desktop. The `next` cursor is stored in
   the URL so refresh keeps position.
6. **UUIDs are never shown.** Entities reference each other by name.

## 8. Shared components

| Component | Notes |
| --- | --- |
| `SearchBar` | Debounced server search (`?search=`, D12); results replace the list below it. |
| `NumericKeypad` | For quantity/amount entry (sales, stock, payments). Large 3×4 keypad, backspace, decimal point for money only. |
| `MoneyText` | Rupee format + sign color. |
| `VoidBadge` | Grey strikethrough VOIDED chip (D18.9); not tappable. |
| `PaginatedList` | Enforces rule §7; consumes `{ data, paging }` (D12). |
| `BottomSheet` | Mobile "More" menu + confirm dialogs. |
| `ConfirmSheet` | Irreversible-action confirmation (void, delete, ban) — requires typed reason for voids. |
| `ReportView` | Renders summary tiles + collapsible sections from any D7 payload. |
| `Toast` | Non-blocking success; errors are inline, not toasts. |

## 9. Error, loading, empty states (global)

- **Loading:** skeleton rows matching the card/table shape (never a spinner
  alone).
- **Empty:** a friendly illustration-free message + the primary action that
  would populate it (e.g. "No products yet — add your first product").
- **Error:** the API's exact `{ message }` (sanitized, F-03) shown inline with
  a **Retry** button; 401 → redirect to `/sign-in`; 429 → "Too many actions,
  wait a moment" with the rate-limit note (F-08); 403 → hide the action
  entirely (the menu was already role-filtered, so this is defensive only).
- **Double-submit:** every state-changing button disables while in flight;
  responses are awaited before re-enabling. A sale can never be posted twice
  by double-tap (D21.3).

## 10. Sign-in screen

**Mobile** (portrait, the common case — owner signing in before the counter opens):

```
┌──────────────────────────────┐
│  ▓▓ logo / shop name ▓▓      │
│                              │
│   Welcome back               │
│   Sign in to the shop        │
│                              │
│   ┌──────────────────────┐   │
│   │ Username              │   │
│   └──────────────────────┘   │
│   ┌──────────────────────┐   │
│   │ Password     👁       │   │
│   └──────────────────────┘   │
│   [  Sign in  ]   ← 56px CTA │
│   ┌──────────────────────┐   │
│   │ ▲ inline error text  │   │
│   └──────────────────────┘   │
│                              │
└──────────────────────────────┘
```

- `POST /api/auth/sign-in/username` (D9). Sign-up disabled (D9.2).
- Failed attempts are rate-limited per IP (F-08) — the error surfaces the
  server message (e.g. "Too many attempts").
- On success → redirect to `/`; the session cookie (D9.5) drives all API calls.

**Tablet/Desktop:** centered card (max 420 px) on a neutral background; same
fields; the CTA is left-aligned in the card instead of bottom-anchored.

## 11. Home

**Mobile** — the daily pulse, one screen:

```
┌──────────────────────────────┐
│ Home                 [ ⚙ ]  │
│                              │
│  Sales today     ₹ 8,450.00  │  ← shop-local "today" (Q4)
│  ─────────────────────────   │
│  Wallet         ₹ 12,340.00  │  (OWNER only, read-only)
│                              │
│  ┌────────────────────────┐  │
│  │  [ + New Sale ]  [ ₩ ] │  │  ← big split CTA
│  └────────────────────────┘  │
│                              │
│  Recent sales                │
│  ┌────────────────────────┐  │
│  │ CASH  ₹350  · 2 min ago│  │
│  ├────────────────────────┤  │
│  │ CREDIT Ram ₹1,200  · 1h │  │
│  ├────────────────────────┤  │
│  │ ECASH  ₹80  · 2h       │  │
│  └────────────────────────┘  │
│                              │
│  [More history →]            │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │  ← bottom tab bar
└──────────────────────────────┘
```

- Data: `GET /api/reports/sales?from=today` (sales total — "today" computed
  shop-local, Q4), `GET /api/reports/wallet?from=today` (wallet, OWNER,
  read-only — Q1), `GET /api/sales?limit=5`. **No low-stock alert in M21**
  (Q3): stock levels appear only on the stock/products screens as plain
  `stockQty`.
- Quick actions: **+ New Sale** (primary), **Receive payment** (opens customer
  search), **Adjust stock**.
- CASHIER sees no wallet tile (D9.6).
- No day-close button anywhere (Q5) — the Today summary is live, not a
  snapshot.

**Tablet:** two-column: left = snapshot + quick actions, right = recent sales.
**Desktop:** three columns — snapshot, recent sales, stock (plain stockQty, no
low-stock labels).

## 12. Page-by-page wireframes

> Conventions: `[ CTA ]` = button; `[ x ]` = icon/tab; `▧▧` = bottom tab bar;
> `▲` = inline error; `≡` = menu. Every mobile frame is a portrait phone.

### 12.1 New Sale — the centerpiece (`/sales/new`)

**Mobile** — split: product picker (top) + cart (bottom, sticky total):

```
┌──────────────────────────────┐
│  New Sale             [ 🧾 ] │
│                              │
│  ┌────────────────────────┐  │
│  │ 🔍 Search product…     │  │  ← type-ahead, server search
│  └────────────────────────┘  │
│                              │
│  Results (matches)           │
│  ┌────────────────────────┐  │
│  │ Rice        ₹70/pcs    │  │  stock 13  [+]
│  ├────────────────────────┤  │
│  │ Oil         ₹180/L     │  │  stock 10  [+]
│  ├────────────────────────┤  │
│  │ Biscuits    ₹10/pcs    │  │  stock 30  [+]
│  └────────────────────────┘  │
│   (tier hint: 3 for 20 shown │
│    when qty crosses tier)    │
│                              │
│  ─── Cart (2 items) ───      │
│  ┌────────────────────────┐  │
│  │ Rice    2 × ₹70 = ₹140 │  │
│  │ Oil     1 × ₹180 = ₹180│  │
│  └────────────────────────┘  │
│                              │
│  Payment:  [ CASH ] [ECASH]  │
│            [ CREDIT ]        │  ← 3 large segmented buttons
│  Customer (CREDIT only)      │
│  ┌────────────────────────┐  │
│  │ 🔍 Search customer…    │  │  ← appears only for CREDIT
│  └────────────────────────┘  │
│                              │
│  Total            ₹ 320.00   │  ← large, updates live
│  [  Save sale  ]  ← 56px CTA │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

Interaction rules:

- **Tap `[+]`** adds 1 unit and scrolls the row into the cart; `[+]` becomes
  `[−] 2 [+]` stepper on the picked row. A long-press opens the numeric
  keypad for bulk quantity.
- Search hits the debounced `GET /api/products?search=`; stock shown inline
  prevents selling below stock (the API is the authority — 409 surfaces if a
  concurrent sale drained it).
- **Tier pricing hint (D1):** when a cart line quantity crosses a `priceTier`
  `minQty`, the row shows "Tier: 3 for ₹20" and the server is still
  authoritative for `total` — the UI never computes the final price itself.
- **CASH/ECASH:** customer stays hidden (walk-in). **CREDIT:** customer picker
  becomes mandatory; save is disabled until one is chosen (API also 400s).
- `POST /api/sales { paymentType, customerId?, items }`. On 201 → toast
  "Sale saved ₹320" and the screen resets to a fresh cart (keeps the customer
  when CREDIT).

**Tablet:** picker (left 2/3) and cart (right 1/3, sticky) side by side.
**Desktop:** same two-pane; customer search for CREDIT is a modal; keyboard
`Enter` in the search field adds the top match, `+`/`-` adjust qty — a
counter-friendly mode.

### 12.2 Sales list (`/sales`)

**Mobile** — filter chips + cards:

```
┌──────────────────────────────┐
│  Sales            [ 🔍 ]     │
│  (All) (CASH) (ECASH) (CRED) │  ← horizontal chip filter
│                              │
│  ┌────────────────────────┐  │
│  │ ₹350 · CASH            │  │
│  │ today 2:41 PM · walk-in│  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ ₹1,200 · CREDIT · Ram  │  │
│  │ today 1:10 PM · 2 items│  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ ₹80 · ECASH            │  │
│  │ today 11:02 AM · walkin│  │
│  └────────────────────────┘  │
│  [Load more →]              │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

- `GET /api/sales?paymentType=&cursor=&limit=`. VOIDED sales show the grey
  `VOIDED` badge and are sorted normally (D18.9).
- Tap → detail (below). **Desktop:** real table (date, payment, customer,
  total, items, status) with sticky header + Prev/Next.

### 12.3 Sale detail (`/sales/[id]`)

```
┌──────────────────────────────┐
│  Sale             [ 🧾 ]     │
│  ₹320.00 · CASH             │
│  today 2:41 PM · walk-in    │
│                              │
│  Items                       │
│  ┌────────────────────────┐  │
│  │ Rice      2 × ₹70  ₹140│  │
│  │ Oil       1 × ₹180 ₹180│  │
│  └────────────────────────┘  │
│  Total                ₹320  │
│                              │
│  ── Wallet effect ──         │
│  DEPOSIT +₹320 (SALE)        │
│                              │
│  ── Stock effect ──          │
│  Rice −2 · Oil −1            │
│                              │
│  [ Void sale ]  (OWNER only) │  → ConfirmSheet, reason required
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

- `GET /api/sales/[id]`. If `voidInfo` present → replace items/wallet/stock
  sections with a single `VOIDED` banner (reason, who, when) and remove the
  Void button (D18).
- Void posts to `POST /api/sales/[id]/void` with `{ reason, note? }`.

### 12.4 Products list (`/products`)

**Mobile:** search bar + category chips + cards:

```
┌──────────────────────────────┐
│  Products          [ ＋ ]    │  [＋] OWNER only → /products/new
│  🔍 Search name…             │
│  (All) (Grocery) (Oil) …     │
│  ┌────────────────────────┐  │
│  │ Rice        ₹70 / pcs  │  │
│  │ Stock 13 · Cost ₹55    │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ Oil         ₹180 / L   │  │
│  │ Stock 10 · Cost ₹150   │  │
│  └────────────────────────┘  │
│  [Load more →]              │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

- `GET /api/products?search=&category=&cursor=`. **No low-stock badge in M21**
  (Q3) — the stock line always shows the plain `stockQty`. **Desktop:** table
  with sticky header + filters in a toolbar row.

### 12.5 New product (`/products/new`, OWNER)

Form, single column on mobile / two-column on desktop: Name, Unit (select
with free text: `pcs`, `kg`, `L`, …), Category (optional), Cost price,
Current price (numeric keypad, rupees), and a repeatable **Price tiers**
section (`min qty` + `price` rows, "+ Add tier" — max 50, unique `minQty`,
D1). Submit → `POST /api/products`; errors render inline next to the field.

### 12.6 Product detail (`/products/[id]`)

Summary card (name, unit, stock with amber warn, cost, current price), tier
table (renders as cards on mobile), and **Stock movements for this product**
(`GET /api/stock/movements?productId=`) showing `+qty`/`−qty` per reason
(PURCHASE/SALE/DAMAGE/CORRECTION, VOID excluded from reports but shown with
badge). No edit button — master data is create-only on the backend (F-07
design); a correction goes through stock adjust for quantity.

### 12.7 Stock movements (`/stock/movements`)

**Mobile:**

```
┌──────────────────────────────┐
│  Stock              [ ⇄ ]    │  ← /stock/adjust
│  (All)(PURCH)(SALE)(DAMAGE)  │
│  (CORRECTION)                │
│  ┌────────────────────────┐  │
│  │ Rice              −2   │  │  SALE · red
│  ├────────────────────────┤  │
│  │ Oil              +10   │  │  PURCHASE · green
│  ├────────────────────────┤  │
│  │ Biscuits          −5   │  │  DAMAGE · red
│  └────────────────────────┘  │
│  [Load more →]              │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

- `GET /api/stock/movements?reason=&productId=&cursor=`. A CORRECTION movement
  with a void badge shows the reversal. Tap a movement → detail with note,
  date, and Void button (OWNER).

### 12.8 Stock adjustment (`/stock/adjust`)

```
┌──────────────────────────────┐
│  Adjust stock                │
│  Type:   [DAMAGE] [CORRECTN] │  ← segmented
│  ┌────────────────────────┐  │
│  │ 🔍 Search product…     │  │
│  └────────────────────────┘  │
│  Current stock: Rice = 13    │
│                              │
│  Quantity  [ 2 ]   ▲ 7 ▼     │  ← keypad or stepper
│  (DAMAGE: 2 ruined ·        │
│   CORRECT: set level to 2)   │
│  Preview: 13 − 2 → 11        │  ← live, only for DAMAGE
│  Note (optional)             │
│  ┌────────────────────────┐  │
│  │ ▓▓ keypad 1 2 3 …      │  │
│  └────────────────────────┘  │
│  [  Save adjustment  ]      │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

- `POST /api/stock/adjustments { productId, adjustmentType, quantity, note }`
  (D6). DAMAGE applies `−quantity`; CORRECTION sets the level to `quantity`.
  The preview shows the resulting stock so the counter cannot be surprised;
  the API enforces ≥ 0 (409).
- **Desktop:** keypad is an inline numeric field; preview + current stock in a
  side summary.

### 12.9 Customers list (`/customers`)

Search + cards. Card shows name, contact, and the **signed balance** — red
`₹ 500 owed` or green `₹ 100 prepaid` (D4), plus a `₹ [Receive]` quick-action
button per card.

### 12.10 Customer detail (`/customers/[id]`)

```
┌──────────────────────────────┐
│  Ram                     🖉  │
│  9801 234 567                │
│  ┌────────────────────────┐  │
│  │ Balance:  ₹ 500 owed   │  │  red card
│  └────────────────────────┘  │
│  [ Receive payment ]  [Sale] │  ← /customers/[id]/pay, /sales/new (prefilled CREDIT)
│                              │
│  Recent payments             │
│  ┌────────────────────────┐  │
│  │ −₹300 · 2 Aug · sale # │  │
│  └────────────────────────┘  │
│  Recent sales                │
│  ┌────────────────────────┐  │
│  │ CREDIT ₹1,200 · 1 Aug  │  │
│  └────────────────────────┘  │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

- `GET /api/customers/[id]`, `GET /api/customer-payments?customerId=`.
  **Per-customer sales history is NOT shown in M21** (Q2) — `GET /api/sales`
  has no `customerId` filter today and M21 adds none. The detail shows the
  signed balance (D4) + payment history; to see a customer's CREDIT sales the
  owner uses the sales list filtered by `paymentType=CREDIT` (all credit sales,
  not per-customer). When the backend later gains a `customerId` filter, extend
  this screen with that customer's CREDIT sales (backlog).
- **Receive payment** → `POST /api/customer-payments { customerId, amount,
  saleId? }` with amount keypad and an optional "pay off a specific sale"
  picker (D5). Owner can void a payment from its history.

### 12.11 Suppliers list + detail + pay (`/suppliers*`, OWNER actions)

Same shape as customers, mirrored (D21.6): card shows `balanceOwed` (what the
shop owes — red when positive), quick "Pay" action. Detail shows purchases and
payments; **Pay supplier** → `POST /api/supplier-payments { supplierId,
amount }`. New supplier is OWNER-only; CASHIER sees the list read-only.

### 12.12 Purchases (`/purchases*`, OWNER)

List: cards with supplier name, `CASH/CREDIT` chip, total, date. **New
purchase:** supplier search + item rows (product search, `qty`, `costPerUnit`
via keypad) + `CASH/CREDIT` choice + running total → `POST /api/purchases`
(D3). Detail shows items, wallet/stock effects, and a Void button (D18).

### 12.13 Reports (`/reports` + 6 report pages)

**Hub (`/reports`)** — role-filtered tiles:

```
┌──────────────────────────────┐
│  Reports                     │
│  ┌──────────┐ ┌──────────┐  │
│  │ Sales    │ │ Purchases│  │
│  │  [open]  │ │  [open]  │  │  (Purchases OWNER only)
│  └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐  │
│  │ Stock    │ │ Customers│  │
│  └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐  │
│  │ Suppliers│ │ Wallet   │  │  (Wallet OWNER only)
│  └──────────┘ └──────────┘  │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

**Report page** (e.g. `/reports/sales`) — the D7 payload rendered via
`ReportView`:

```
┌──────────────────────────────┐
│  Sales report      [ ⤓ ]     │  ⤓ = export menu (CSV/JSON)
│  From ▓▓ To ▓▓ (date pickers)│  ← range, D10
│                              │
│  ┌─────────┬─────────┬─────┐ │
│  │ Total   │ # Sales │ Avg │ │  ← summary tiles
│  │ ₹8,450  │  37     │ ₹228│ │
│  └─────────┴─────────┴─────┘ │
│                              │
│  ▶ By payment type           │  ← collapsible section
│    CASH  ₹6,000 · 28         │
│    ECASH ₹ 850 · 5           │
│    CREDIT ₹1,600 · 4         │
│  ▶ Products sold             │  ← card list on mobile
│    Rice        120 · ₹7,900  │
│    Oil          30 · ₹5,400  │
│                              │
│ ▧▧ Home │ Sell │ Stock │ Cus │
└──────────────────────────────┘
```

- `GET /api/reports/{name}?from=&to=` (D7, D10). Range presets (Q4): **Today
  (default) / Last 7 days / Last 30 days / This month / Custom range**. The
  `from`/`to` values are computed in the shop-local timezone from the report's
  echoed `range` (never the phone/browser timezone); no stored ranges (D7).
- **Export:** `GET /api/exports/{name}?format=csv|json&from=&to=` — the
  browser downloads the file (`Content-Disposition`, D20.1); an OWNER-only
  export stays OWNER-only (D20.3).
- **Desktop/tablet:** sections render as full tables (not cards) per §7; the
  export button is in the toolbar.
- CASHIER reaches only Sales + Stock reports from the hub (D9.6/D20.3).

### 12.14 Users (`/users`, OWNER)

List of users (username, role chip, status). "Add user" → `POST /api/users
{ username, password, role }` (min 8-char password, D9.4). Per-user actions:
change role, ban/unban, reset password (revokes sessions, D9.5), delete — each
behind `ConfirmSheet`; the last-OWNER invariant surfaces the API's 400 message
(D9.7). Mobile uses bottom sheets; desktop uses a detail pane.

### 12.15 Settings (`/settings`)

Signed-in user (username + role, from the session), ERP timezone note
(display-only, D10), **wallet balance (OWNER, read-only, from
`GET /api/reports/wallet` over full history — Q1)**, sign out
(`POST /api/auth/sign-out`). No other settings — system config stays in `.env`.
There is no wallet edit form and no transaction-level list (neither exists on
the backend; manual entries deferred, Q1).

## 13. Implementation order

Proposed phases (each ends green on `tsc`/`lint`/tests; backend gate untouched):

1. **Phase A — Shell & sign-in:** layout, role-adaptive navigation (§5.2),
   CSP for UI pages (D21.1), `/sign-in`, `/`, `/settings`. Acceptance: both
   roles can sign in; menu matches §5.3; mobile/tablet/desktop layouts per
   §6/§11.
2. **Phase B.1 — POS new-sale screen:** `/sales/new` is complete and accepted.
   Acceptance: product search/filter, add-to-cart, payment type selection,
   customer selection/creation for CREDIT, save flow, inline validation/error
   handling, and mobile cart UX all work without backend changes.
3. **Phase B.2 — Sales list + detail + OWNER void flow:** COMPLETE
   (committed `a147d9a`, 17 Aug 2026). `/sales` list with cursor pagination and
   payment-type filtering; `/sales/[id]` detail with item-level data, status,
   and void information; OWNER void flow with confirmation, reason validation,
   and query invalidation. All consuming the existing sales APIs — no backend
   changes required.
4. **Phase C.1 — Products & stock frontend:** COMPLETE
   (committed `8a4cc99`, 17 Aug 2026). Products list/search/filter/detail/create,
   stock movements list with reason filter, stock adjustment form (DAMAGE/CORRECTION).
   14 new tests (85 total frontend). All consuming existing APIs — no backend changes required.
5. **Phase C.2 — Customers & payments:** COMPLETE
   (committed `3fd071e`, 17 Aug 2026). Customers list/new/detail, receive payment,
   payment history with OWNER-only void flow, optional sale linkage (best-effort).
   21 new tests (106 total frontend). All consuming existing APIs — no backend changes required.
6. **Phase D — Suppliers, purchases, reports, users:** (next — pending PM approval).

### C.2 API contract and backend boundary

C.2 uses the current backend contracts; no new customer/payment endpoints are required.

- `GET /api/customers?search=&cursor=&limit=` — paginated customer list (D12)
- `POST /api/customers` — create customer (name, contact)
- `GET /api/customers/[id]` — customer detail with signed `balanceOwed` (D4)
- `GET /api/customer-payments?customerId=&limit=` — paginated payment history
- `POST /api/customer-payments` — receive payment (`customerId`, `amount`, optional `saleId` for CREDIT linkage, D5)
- `POST /api/customer-payments/[id]/void` — OWNER-only payment void with `reason` (D18)
- `GET /api/sales?paymentType=CREDIT&limit=` — best-effort sale picker for optional linkage (no `customerId` filter — Q2 deferred)

**Required backend work for C.2:** none. The existing customer and customer-payment APIs were sufficient.

**Deferred to backend backlog (not C.2):**
- `customerId` filter on `GET /api/sales` for per-customer CREDIT-sale history (Q2)

### C.2 acceptance criteria

- `/customers` renders a list of customers with name, contact, and signed balance (red owed / green prepaid).
- Rows support cursor pagination and search.
- `/customers/new` creates a customer (name, optional contact) and navigates back to the list.
- `/customers/[id]` renders customer info, signed balance, action buttons (Receive payment, Sale), and payment history.
- `/customers/[id]/pay` submits a payment (amount, optional sale linkage to a CREDIT sale), then navigates to the customer detail.
- OWNER users can void a payment from the customer's payment history with required reason; CASHIER sees no void button.
- Payment void invalidates payment and customer queries so balance and history update.
- Loading, empty, and error states are present for all screens.
- No frontend code invents business logic; balances, payment totals, and void semantics remain server-authoritative.

### B.2 API contract and backend boundary

B.2 uses the current backend contracts already in the repository; no new sales endpoints are required for the minimum UI slice.

- `GET /api/sales` — list sales, with existing pagination and `paymentType` filter support (`limit`, `cursor`, `paymentType`)
- `GET /api/sales/[id]` — fetch one sale and its item list
- `POST /api/sales/[id]/void` — OWNER-only void, with `reason` and optional `note`
- `GET /api/customers` — optional customer lookup for display details when a sale is attached to a customer

**Required backend work for B.2:** none for the minimum flow. The UI can be built against the existing routes and response shapes.

**Optional backend work (deferred, not required for B.2):**
- a `customerId` filter on `GET /api/sales` for customer-scoped sales history
- a text search filter on `GET /api/sales` for product/customer text lookup at the server layer
- any richer sales reporting/filtering beyond the current list API contract

### B.2 acceptance criteria

- `/sales` renders a list of sales rows with date, payment type, total, customer or walk-in label, status, and void badge.
- Rows are linkable to `/sales/[id]`.
- The list supports existing `limit` / `cursor` pagination and `paymentType` filtering.
- `/sales/[id]` renders the sale total, payment type, timestamp, customer, item rows, and the current void state.
- OWNER users can trigger the void flow only from the sale detail page and confirm reason/note before submission.
- Inline error handling is present for network, validation, and role failures.
- Loading, empty, and retry states are present for both list and detail screens.
- Mobile layout uses card-style rows and bottom-sheet or compact filter surfaces without horizontal overflow.
- No frontend code invents business logic; totals, validation, stock changes, and void semantics remain server-authoritative.

### B.2 frontend test coverage

The B.2 frontend slice should be covered with the same gate expectations as B.1:

- list rendering: loading, empty, retry, and populated states
- list pagination and payment-type filtering behavior
- navigation from sale row to detail page
- detail rendering for sale total, customer, payment, item rows, status, and void state
- OWNER-only void flow with confirm step and API error propagation
- role-gating and auth-state checks for void and detail access
- mobile-specific layout and interaction tests for list rows and filter surfaces
- regression tests for sale detail behavior after a successful void

## 14. PM decisions on open questions (resolved 15 Aug 2026)

All five M21 open questions were answered by the PM. Each decision keeps M21
frontend-only against the existing backend capabilities.

1. **Wallet manual entries — DEFERRED to backend backlog.** The wallet stays
   read-only in M21 (driven only by sales, payments, supplier payments, and
   voids, as today D3/D7). Manual entries (`OWNER_WITHDRAWAL`, `EXPENSE`,
   `BANK_DEPOSIT`, `OTHER` — already in the `WalletTxnSource` enum,
   `modules/wallet/wallet.types.ts`) are recorded as a future backend
   milestone. No `POST /api/wallet`, no schema change, no backend code in M21.
   Settings shows the wallet read-only: balance from `GET /api/reports/wallet`
   (no transaction-level list exists on the backend).
2. **Customer-filtered sales list — DEFERRED to backend backlog.** M21 does
   not touch `GET /api/sales` and adds no endpoint. Customer detail shows the
   signed balance (D4) + the customer's payment history
   (`GET /api/customer-payments?customerId=`); per-customer CREDIT-sale
   history is **not** shown. When the backend gains a `customerId` filter,
   customer detail should be extended with that customer's CREDIT sales and
   relevant transaction history.
3. **Low-stock threshold — DEFERRED (no alert in M21).** No hardcoded
   threshold. M21 always shows the real `stockQty` plainly and never labels a
   product "low stock". A per-product reorder point / low-stock threshold
   model (product-specific, not a global constant) is recorded for the backend
   roadmap.
4. **Report date presets — APPROVED, frontend-only.** Presets: **Today
   (default) / Last 7 days / Last 30 days / This month / Custom range.** The
   frontend computes the boundaries in the **shop-local timezone** (never the
   phone/browser timezone), deriving the shop's offset from the report's
   echoed `range` (the only available backend signal). No timezone endpoint,
   no backend change. The Home "Today's summary" uses the same shop-local
   "today" calculation.
5. **Close of day — DEFERRED entirely to backlog.** M21 Home shows only a live
   "Today" summary from the existing sales report. No close-of-day button,
   snapshot, schema, endpoint, or cash-count workflow in M21. The future
   design should consider `POST /api/day-close`, an immutable daily snapshot
   keyed by shop-local date, payment-type totals, wallet balance, optional
   physical cash count, notes, and an already-closed guard.

### Backend backlog recorded from these decisions

- Manual wallet entries: `POST /api/wallet` (deposit/withdraw, amount + note +
  source `OWNER_WITHDRAWAL|EXPENSE|BANK_DEPOSIT|OTHER`), OWNER-only, keeps
  the `balance == Σ DEPOSIT − Σ WITHDRAWAL` invariant (D6).
- Customer-specific sales history: additive `customerId` filter on
  `GET /api/sales` (+ service + tests); extend customer detail UI to show that
  customer's CREDIT sales.
- Per-product reorder point / low-stock threshold (product-specific, no global
  constant), exposed on product create/update and surfaced as a real low-stock
  signal.
- Day close / daily reconciliation: `POST /api/day-close` + immutable
  snapshot (shop-local date, payment-type totals, wallet balance, optional
  cash count, notes, already-closed guard).

None of these are scheduled in M21.

## 15. Dependencies & constraints recap

- Everything renders from existing `/api/*` responses; no new API contract.
- Same-origin only (F-11 no-CORS); session cookie from Better Auth (D9.5).
- Money in rupees on the wire (D11); timezone labels from the report `range`
  echo (D10); VOIDED state from `voidInfo` (D18.9).
- UI page CSP added in Phase A; the `/api` CSP is untouched.
- No business math in the frontend: totals, tiers, stock deltas, and balances
  are always the API's numbers.

## 16. Architecture & stack (D22, accepted 15 Aug 2026)

Full decision in `docs/business-decisions.md` (D22.1–D22.7). Summary:

**Stack:** Next.js 16 App Router (RSC shell + minimal client islands) · Tailwind
v4 · `better-auth/react` (session). New deps: TanStack Query (server state),
Zustand (cart only), React Hook Form + Zod (+ `@hookform/resolvers`), shadcn/ui
(curated subset) + lucide-react (icons) + Sonner (success toasts).
**Not added:** Recharts (plan §2, backlog), `@tanstack/react-table` (semantic
`<table>`; revisit only if column features are wanted), Playwright (post-M21),
Redux.

**State separation (D22.2):**

| Concern | Owner |
| --- | --- |
| Server state | TanStack Query (per-resource query keys; mutations invalidate dependents) |
| Client-global | Zustand — POS cart only (items, qty, paymentType, customerId) |
| Local UI | `useState` (sheet open, section collapse, search focus, keypad) |
| URL | `searchParams` — filters, cursor `next`, report `from`/`to` (Next 16 async `searchParams`) |
| Forms | React Hook Form + Zod (schemas mirror backend validators) |
| Business math | Backend only (pricing, tiers, totals, stock, wallet, balances, cost, voids); frontend math is preview/UX only |

**Responsive (D22.3):** <768px bottom tab bar + bottom-sticky CTA (56px) ·
768–1199px icon rail (72px) · ≥1200px sidebar (240px). Row→card (mobile) →
2-col grid (tablet) → semantic table (desktop, sticky header). Touch ≥44px,
body 16px, safe-area insets, no hover-only interactions, WCAG AA, Devanagari
font.

**Testing (D22.6):** Vitest unit (node env: format, shop-local dates, cursor,
schemas) + Vitest component (jsdom + RTL + user-event: sales entry, search
debounce, ConfirmSheet, PaginatedList, role-adaptive nav, MoneyText/VoidBadge)
via a new `test:frontend` in the gate. Playwright deferred.

**API integration (D22.5):** one typed `lib/api/client.ts` (same-origin,
`{ message }` errors, typed payloads); wire types reused from `@/modules/*`
via `import type`; exports via Content-Disposition links.
