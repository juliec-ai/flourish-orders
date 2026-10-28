# Shop Orders (Brigham Floral / Flourish)

Staff order-entry dashboard. Staff sign in with email and PIN, take an order, and it is saved to Infinity, which stays the system of record. Phase 1 covers order intake and the open-orders list.

Runs on ordinary PHP hosting (built for the SiteGround GrowBig plan): PHP 8.1 or newer with the curl extension. No database.

## Layout

```
site/
  public_html/     the only folder the web can reach: staff screen + api.php
  app/             PHP code (Infinity client, login, order rules)
  config.php       your settings and secrets (you create it from config.sample.php)
  data/            short-lived cache and login lockouts (created automatically)
  tools/           hash-pin.php for staff PINs, dev-router.php for local testing
tests/run.php
```

The Infinity token and staff PINs live in `config.php`, beside `public_html` rather than inside it, so a browser can never load them. PINs are stored as bcrypt hashes. Five wrong PINs lock that email for 15 minutes.

## What saving an order does

1. Checks the order (customer, at least one item, due date, address for deliveries).
2. Adds the customer to the Customers board if they are new.
3. Works out subtotal, delivery fee, tax (taxable items only, none for tax-exempt customers) and total.
4. Gives the order a number like `261028-03` (date + count for the day).
5. Creates the Orders item with status New, linked to the customer and any catalog products, with "Taken by" in Notes.

The Orders tab lists open orders by due date and lets staff change Status and Payment status.

Fields are found by name in Infinity, so they can be reordered there. Renaming a field or a label option the app uses (for example "Due Date" or "Paid") needs a matching change here.

Payments: phase 1 records Payment Status and an optional Stripe payment ID. Charging cards from this screen is a later phase.

## Install on SiteGround

1. **Site Tools > Domain > Subdomains:** create `orders.brighamfloral.com`. SiteGround makes the folder `www/orders.brighamfloral.com/public_html`.
2. **Security > SSL Manager:** add a free Let's Encrypt certificate for the subdomain, then turn on **HTTPS Enforce**.
3. **Devs > PHP Manager:** set the subdomain to **Managed PHP** (8.2 or newer) so SiteGround keeps it patched.
4. **Site Tools > File Manager:** in `www/orders.brighamfloral.com/`, upload the contents of `site/` so that `app/`, `config.sample.php` and `tools/` sit next to `public_html/`, and the files from `site/public_html/` (including the hidden `.htaccess`) are inside `public_html/`.
5. Copy `config.sample.php` to `config.php` and fill in the Infinity token, a session secret, the staff list, and the tax rate. Make PIN hashes and the secret with `php tools/hash-pin.php 1234` and `php tools/hash-pin.php --secret` (SiteGround SSH), or ask Claude to prepare them.
6. Open `https://orders.brighamfloral.com` and sign in. Then add a top-tab link to it in Jadesites.

Opening it in its own tab is the reliable choice. Embedding it inside a Jadesites page can break sign-in on iPads and Safari, which block cookies inside embeds.

## Local testing

```bash
cd site
cp config.sample.php config.php   # fill in
php -S localhost:8000 -t public_html tools/dev-router.php
php ../tests/run.php
```
