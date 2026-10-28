const path = require('path');
const express = require('express');
const { createInfinity, InfinityError } = require('./infinity');
const { createAuth, loadStaff } = require('./auth');
const O = require('./orders');

const env = process.env;
for (const k of ['INFINITY_TOKEN', 'SESSION_SECRET']) {
  if (!env[k]) {
    console.error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const BOARDS = {
  customers: env.CUSTOMERS_BOARD || '692YNE7vaYz',
  products: env.PRODUCTS_BOARD || 'ar2atxGwR7m',
  orders: env.ORDERS_BOARD || '9VF3MFPmMZL',
};
const TAX_RATE = Number(env.TAX_RATE || 0);
const DELIVERY_FEE = Number(env.DELIVERY_FEE || 0);
const DEFAULT_BRAND = env.DEFAULT_BRAND || 'Brigham Floral and Gift';
const CHANNEL_TO_SOURCE = { Counter: 'Walk-in', Phone: 'Phone', Website: 'Website', 'FSN Network': 'FSN Network' };

const inf = createInfinity({ token: env.INFINITY_TOKEN, workspace: env.INFINITY_WORKSPACE || '62514' });
const staff = loadStaff();
const auth = createAuth({ secret: env.SESSION_SECRET, staff, secure: env.NODE_ENV === 'production' });

// Short-lived caches so typing in search boxes doesn't hit Infinity's rate limit.
const cache = new Map();
async function cached(key, ms, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + ms });
  return value;
}
const forget = (key) => cache.delete(key);

async function allFlat(board, key) {
  return cached(key, 60e3, async () => {
    const items = await inf.listItems(board);
    return Promise.all(items.map((i) => inf.flatten(board, i)));
  });
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; frame-ancestors 'self' https://*.jadesites.com https://brighamfloral.com https://*.brighamfloral.com");
  next();
});
// Writes must be JSON, which a plain cross-site form cannot send.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'JSON only' });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.use('/api', auth.requireStaff);

app.get('/api/me', (req, res) => res.json({ name: req.staff.name, email: req.staff.email }));

app.get('/api/options', wrap(async (req, res) => {
  const [o, c] = await Promise.all([inf.schema(BOARDS.orders), inf.schema(BOARDS.customers)]);
  const labels = (s, name) => Object.keys(s.byName[name]?.labels || {});
  res.json({
    occasion: labels(o, 'Occasion'),
    fulfillment: labels(o, 'Fulfillment'),
    channel: labels(o, 'Channel'),
    status: labels(o, 'Status'),
    paymentStatus: labels(o, 'Payment Status'),
    brand: labels(o, 'Brand'),
    customerType: labels(c, 'Customer Type'),
    taxRate: TAX_RATE,
    deliveryFee: DELIVERY_FEE,
    defaultBrand: DEFAULT_BRAND,
  });
}));

app.get('/api/products', wrap(async (req, res) => {
  const list = await allFlat(BOARDS.products, 'products');
  res.json(
    list
      .filter((p) => p.Active !== false && p.Name)
      .map((p) => ({
        id: p.id,
        name: p.Name,
        size: p.Size?.[0] || '',
        category: p.Category?.[0] || '',
        brand: p.Brand?.[0] || '',
        price: Number(p.Price || 0),
        taxable: p.Taxable !== false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}));

const customerView = (c) => ({
  id: c.id,
  name: c.Name || '',
  phone: c.Phone || '',
  email: c.Email || '',
  address: [c.Address, c.City, c.State, c.ZIP].filter(Boolean).join(', '),
  taxExempt: c['Tax Exempt'] === true,
  houseAccount: c['House Account'] === true,
});

app.get('/api/customers', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = await allFlat(BOARDS.customers, 'customers');
  const hits = list.filter((c) => {
    if (!q) return true;
    if ((c.Name || '').toLowerCase().includes(q) || (c.Email || '').toLowerCase().includes(q)) return true;
    return digits.length >= 3 && String(c.Phone || '').replace(/\D/g, '').includes(digits);
  });
  res.json(hits.slice(0, 20).map(customerView));
}));

const orderView = (o) => ({
  id: o.id,
  number: o['Order Number'] || '',
  name: o.Name || '',
  recipient: o['Recipient Name'] || '',
  address: o['Recipient Address'] || '',
  due: o['Due Date'] || '',
  fulfillment: o.Fulfillment?.[0] || '',
  status: o.Status?.[0] || '',
  paymentStatus: o['Payment Status']?.[0] || '',
  brand: o.Brand?.[0] || '',
  total: Number(o.Total || 0),
  lineItems: o['Line Items'] || '',
  cardMessage: o['Card Message'] || '',
  notes: o.Notes || '',
  createdAt: o.created_at,
});

app.get('/api/orders', wrap(async (req, res) => {
  const list = (await allFlat(BOARDS.orders, 'orders')).map(orderView);
  const showDone = req.query.done === '1';
  const done = new Set(['Picked Up', 'Delivered', 'Cancelled']);
  res.json(
    list
      .filter((o) => showDone || !done.has(o.status))
      .sort((a, b) => String(a.due).localeCompare(String(b.due))),
  );
}));

let creating = Promise.resolve();
app.post('/api/orders', wrap(async (req, res) => {
  const order = req.body || {};
  const lines = O.validateOrder(order);

  // One order at a time, so two staff saving together can't get the same number.
  const result = await (creating = creating.catch(() => {}).then(async () => {
    let customerId = order.customer.id;
    let taxExempt = false;
    if (customerId) {
      const known = (await allFlat(BOARDS.customers, 'customers')).find((c) => c.id === customerId);
      taxExempt = known?.['Tax Exempt'] === true;
    } else {
      const created = await inf.createItem(BOARDS.customers, O.customerFields({ ...order.customer, source: CHANNEL_TO_SOURCE[order.channel] }));
      customerId = created.id;
      forget('customers');
    }

    const totals = O.computeTotals({
      lines,
      deliveryFee: order.fulfillment === 'Delivery' ? (order.deliveryFee ?? DELIVERY_FEE) : 0,
      taxRate: TAX_RATE,
      taxExempt,
    });
    forget('orders');
    const existing = (await allFlat(BOARDS.orders, 'orders')).map((o) => o['Order Number']);
    const number = O.nextOrderNumber(existing, O.datePrefix());
    const created = await inf.createItem(BOARDS.orders, O.orderFields({ order, lines, totals, number, customerId, staff: req.staff }));
    forget('orders');
    return { id: created.id, number, totals };
  }));
  res.status(201).json(result);
}));

app.patch('/api/orders/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  if (b.status) fields.Status = b.status;
  if (b.paymentStatus) fields['Payment Status'] = b.paymentStatus;
  if (b.stripePaymentId) fields['Stripe Payment ID'] = b.stripePaymentId;
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to change.' });
  await inf.updateItem(BOARDS.orders, req.params.id, fields);
  forget('orders');
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err.status && err.status < 500 && !(err instanceof InfinityError)) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(502).json({ error: 'Could not reach Infinity. Try again in a moment.' });
});

const port = Number(env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`Flourish orders on http://localhost:${port}`));
}

module.exports = app;
