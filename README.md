# Shop Orders (Brigham Floral / Flourish)

Staff order-entry dashboard. Staff sign in with email and PIN, take an order, and it is saved to Infinity, which stays the system of record. Phase 1 covers order intake and the open-orders list.

## How it works

- `server/` is a small Node/Express server. It holds the Infinity token, so the token never reaches the browser.
- `public/` is the staff screen (plain HTML/CSS/JS, no build step). Works on desktop, iPad and phone.
- Data lives in the Brigham Floral (BRGM) workspace, in three boards: Customers, Products, Orders. The server finds fields by name, so fields can be reordered in Infinity. Renaming a field or a label option the app uses (for example "Due Date" or "Paid") needs a matching change here.

What saving an order does:

1. Checks the order (customer, at least one item, due date, address for deliveries).
2. Adds the customer to Customers if they are new.
3. Works out subtotal, delivery fee, tax (taxable items only, none for tax-exempt customers) and total.
4. Gives the order a number like `261028-03` (date + count for the day).
5. Creates the Orders item with status New, linked to the customer and any catalog products, with "Taken by" in Notes.

The Orders tab lists open orders by due date and lets staff change Status and Payment status.

Payments: phase 1 records Payment Status and an optional Stripe payment ID. Charging cards from this screen (Stripe Payment Links or Terminal) is a later phase.

## Setup

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env      # then fill it in
npm run hash-pin -- "Julie" julie@brighamfloral.com 1234   # one line per staff member
npm run dev               # http://localhost:3000
```

Put the printed staff entries into `STAFF_USERS` as a JSON list, for example
`STAFF_USERS=[{"name":"Julie","email":"julie@brighamfloral.com","pin":"scrypt:..."}]`.
To remove someone, delete their entry and restart. Five wrong PINs lock that email for 15 minutes.

Settings (see `.env.example`): `INFINITY_TOKEN`, `SESSION_SECRET`, `STAFF_USERS`, `TAX_RATE`, `DELIVERY_FEE`, `DEFAULT_BRAND`, `TZ`.

## Hosting

Any Node host works (start command `npm start`, health check `/healthz`). Set `NODE_ENV=production` so the login cookie is HTTPS-only. Then point `orders.brighamfloral.com` at it with a CNAME record at the DNS provider for brighamfloral.com, leaving the email (MX) records alone, and add a Jadesites top-tab link to `https://orders.brighamfloral.com`.

Opening it in its own tab is the reliable choice. Embedding it inside a Jadesites page can break sign-in on iPads and Safari, which block cookies inside embeds.

## Tests

```bash
npm test
```
