# Shopkeeper — Web App

A responsive web front-end for Shopkeeper, built from scratch with plain
HTML, CSS and vanilla JavaScript (no frameworks, no build step) and the
Firebase JS SDK. It reads and writes the **same Firestore data** as the
Flutter app (same collections, same field names), so a sale or inventory
change made on the phone/desktop app shows up here instantly, and vice
versa. It's wired to your existing Firebase project (`shopkeeper-4c572`).

## What's included

- `index.html` + `js/auth.js` — sign in / create account. Signup creates the
  same `owners/{uid}` + `businesses/{id}` + `business_ids/{publicId}` +
  `owners/{uid}/businesses/{id}` documents as the Flutter app, with the same
  `NAME-YYMMDD-msSS` business ID format.
- `app.html` + `js/app.js` — the authenticated shell: a sidebar on
  desktop/tablet, a bottom tab bar on phones (switches automatically by
  screen width). Settings/Profile is its own tab that keeps the sidebar
  visible, matching the fix made in the Flutter desktop app.
- `js/pages/dashboard.js` — Point of sale: product grid, cart, Normal/Credit
  checkout, tap-to-edit price and quantity.
- `js/pages/inventory.js` — product CRUD with app-generated item IDs.
- `js/pages/expenses.js` — expense tracking with categories, refund/cancel.
- `js/pages/sales.js` — sales history with the same-date visual grouping
  (a subtle blue top-border marks the first sale of each new day) and an
  uncapped **Best Sellers** panel (every product sold this month, ranked
  by quantity), matching this session's Flutter fixes. Also handles
  returns/exchanges and credit-sale cancellation.
- `js/pages/revenue.js` — financial overview: stats, recent activity,
  breakdown table.
- `js/pages/profile.js` — the richer desktop Profile: personal info,
  business details (with edit dialog), lock PIN, a downloadable financial
  report (opens a print-ready summary — save as PDF from the browser's
  print dialog), businesses list (switch/add), WhatsApp support, and a
  danger-zone data wipe.
- `js/services/business-service.js` — mirrors `business_service.dart`
  exactly: same Firestore paths and field names.
- `js/services/lock-service.js` — mirrors `lock_service.dart`: one PIN
  gates Inventory editing, Revenue and Profile together, auto-relocks after
  3 minutes idle.
- `css/styles.css` — the shared design system (the desktop palette/card/
  dialog conventions used across the Flutter app: colors, spacing, cards,
  buttons, tables, modals, toasts, responsive breakpoints).

## Running it locally

Browsers block ES module imports when a page is opened directly as a file
(`file:///...`). Serve it over `http://` instead:

```bash
cd shopkeeper-web
python3 -m http.server 8080
```
Then open `http://localhost:8080` (not the `file://` link).

No Python? In VS Code, install the "Live Server" extension and right-click
`index.html` → "Open with Live Server".

## Scope notes

- This build focuses on the core POS flow (Dashboard, Inventory, Expenses,
  Revenue, Sales, Profile, and auth) — the same pages we've been working on
  in the Flutter app. The subscription/payment paywall and the offline
  local-cache/sync machinery from the Flutter app aren't ported; this web
  version assumes an internet connection.
- The financial report is a simplified printable HTML summary rather than
  the multi-page PDF the Flutter app generates with `pdf_service.dart` —
  use your browser's "Save as PDF" from the print dialog it opens.
