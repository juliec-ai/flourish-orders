// Order rules: totals, order numbers, and the Infinity field mapping.

const money = (n) => Math.round(Number(n) * 100) / 100;
const fmt = (n) => `$${money(n).toFixed(2)}`;

// Today's date in the shop's time zone, as YYMMDD.
function datePrefix(now = new Date(), timeZone = process.env.TZ || 'America/Denver') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: '2-digit', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}${parts.month}${parts.day}`;
}

// Next order number for today, such as 261028-03, given the existing numbers.
function nextOrderNumber(existing, prefix) {
  let max = 0;
  for (const n of existing) {
    const m = String(n || '').match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

function computeTotals({ lines, deliveryFee = 0, taxRate = 0, taxExempt = false }) {
  let subtotal = 0;
  let taxable = 0;
  for (const l of lines) {
    const amount = money(Number(l.qty) * Number(l.price));
    subtotal += amount;
    if (l.taxable !== false) taxable += amount;
  }
  subtotal = money(subtotal);
  const tax = taxExempt ? 0 : money(taxable * taxRate);
  const fee = money(deliveryFee || 0);
  return { subtotal, deliveryFee: fee, tax, total: money(subtotal + fee + tax) };
}

function lineItemsText(lines) {
  return lines
    .map((l) => `${l.qty} x ${l.name} @ ${fmt(l.price)} = ${fmt(Number(l.qty) * Number(l.price))}${l.taxable === false ? ' (no tax)' : ''}`)
    .join('\n');
}

// Checks the order sent by the browser and returns clean lines, or throws with a message for staff.
function validateOrder(o) {
  const errors = [];
  if (!o.customer || (!o.customer.id && !o.customer.name)) errors.push('Choose or add a customer.');
  const lines = (o.lines || [])
    .map((l) => ({
      productId: l.productId || null,
      name: String(l.name || '').trim(),
      qty: Number(l.qty),
      price: Number(l.price),
      taxable: l.taxable !== false,
    }))
    .filter((l) => l.name);
  if (!lines.length) errors.push('Add at least one item.');
  for (const l of lines) {
    if (!(l.qty > 0) || !Number.isFinite(l.price) || l.price < 0) errors.push(`Check quantity and price for "${l.name}".`);
  }
  if (!o.fulfillment) errors.push('Choose how the order goes out (pickup, delivery, or walk-in).');
  if (!o.dueDate) errors.push('Set the due date.');
  if (o.fulfillment === 'Delivery' && !String(o.recipient?.address || '').trim()) {
    errors.push('Delivery orders need a recipient address.');
  }
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    throw err;
  }
  return lines;
}

// Infinity "date with time" value from the form's date and time inputs.
function dueDateValue(date, time) {
  return time ? `${date} ${time}:00` : date;
}

function orderFields({ order, lines, totals, number, customerId, staff }) {
  const r = order.recipient || {};
  const noteLines = [`Taken by: ${staff.name}`];
  if (order.notes) noteLines.push(order.notes);
  return {
    Name: `${number} ${order.customer.name || ''}${r.name ? ` for ${r.name}` : ''}`.trim(),
    'Order Number': number,
    Customer: customerId,
    'Recipient Name': r.name,
    'Recipient Phone': r.phone,
    'Recipient Address': r.address,
    Products: [...new Set(lines.map((l) => l.productId).filter(Boolean))],
    'Line Items': lineItemsText(lines),
    'Card Message': order.cardMessage,
    Occasion: order.occasion,
    Fulfillment: order.fulfillment,
    'Due Date': dueDateValue(order.dueDate, order.dueTime),
    Subtotal: totals.subtotal,
    'Delivery Fee': totals.deliveryFee,
    Tax: totals.tax,
    Total: totals.total,
    'Payment Status': order.paymentStatus || 'Unpaid',
    'Stripe Payment ID': order.stripePaymentId,
    Channel: order.channel,
    Status: 'New',
    'Taken By': staff.infinityUserId,
    Brand: order.brand,
    Notes: noteLines.join('\n'),
  };
}

function customerFields(c) {
  return {
    Name: c.name,
    Phone: c.phone,
    Email: c.email,
    Address: c.address,
    City: c.city,
    State: c.state,
    ZIP: c.zip,
    Source: c.source,
  };
}

module.exports = { money, datePrefix, nextOrderNumber, computeTotals, lineItemsText, validateOrder, dueDateValue, orderFields, customerFields };
