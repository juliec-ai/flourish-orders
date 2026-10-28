(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { options: null, products: [], customer: null, lines: [] };

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { show('login'); throw new Error(data.error || 'Please sign in.'); }
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
    return data;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function show(view) {
    for (const v of ['login', 'new', 'list']) $(`#view-${v}`).hidden = v !== view;
    $('#nav').hidden = view === 'login';
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'list') loadOrders();
  }

  // ---------- sign in ----------
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#login-error').textContent = '';
    try {
      await api('/login', { method: 'POST', body: { email: f.get('email'), pin: f.get('pin') } });
      e.target.reset();
      await start();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST', body: {} }).catch(() => {});
    show('login');
  });
  $$('.tab').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  // ---------- setup ----------
  function fillSelect(id, values, selected) {
    const sel = $(id);
    const keep = sel.querySelector('option[value=""]');
    sel.innerHTML = '';
    if (keep) sel.append(keep);
    for (const v of values) sel.append(new Option(v, v, v === selected, v === selected));
  }

  async function start() {
    const me = await api('/me');
    $('#who').textContent = me.name;
    const [options, products] = await Promise.all([api('/options'), api('/products')]);
    state.options = options;
    state.products = products;
    fillSelect('#opt-occasion', options.occasion);
    $('#product-list').innerHTML = products
      .map((p) => `<option value="${esc(productLabel(p))}"></option>`)
      .join('');
    resetOrder();
    show('new');
  }

  const productLabel = (p) => `${p.name}${p.size ? ` (${p.size})` : ''} - ${fmt(p.price)}`;

  // ---------- customer ----------
  let searchTimer;
  $('#cust-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#cust-results').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const list = await api(`/customers?q=${encodeURIComponent(q)}`).catch(() => []);
      $('#cust-results').innerHTML = list.length
        ? list.map((c, i) => `<li><button type="button" data-i="${i}"><strong>${esc(c.name)}</strong> <span class="muted">${esc(c.phone)} ${esc(c.email)}</span></button></li>`).join('')
        : '<li class="muted">No match. Add them as a new customer below.</li>';
      $$('#cust-results button').forEach((b) => b.addEventListener('click', () => chooseCustomer(list[b.dataset.i])));
      if (!list.length) $('#cust-new').open = true;
    }, 250);
  });

  function chooseCustomer(c) {
    state.customer = c;
    $('#cust-name').textContent = c.name;
    $('#cust-detail').textContent = [c.phone, c.email, c.address, c.taxExempt ? 'Tax exempt' : '', c.houseAccount ? 'House account' : ''].filter(Boolean).join(' · ');
    $('#customer-chosen').hidden = false;
    $('#customer-pick').hidden = true;
    recalc();
  }
  $('#cust-clear').addEventListener('click', () => {
    state.customer = null;
    $('#customer-chosen').hidden = true;
    $('#customer-pick').hidden = false;
    $('#cust-search').value = '';
    $('#cust-results').innerHTML = '';
    recalc();
  });

  function customerPayload(f) {
    if (state.customer) return { id: state.customer.id, name: state.customer.name };
    const name = f.get('c_name').trim();
    if (!name) return null;
    return {
      name,
      phone: f.get('c_phone').trim(),
      email: f.get('c_email').trim(),
      address: f.get('c_address').trim(),
      city: f.get('c_city').trim(),
      state: f.get('c_state').trim(),
      zip: f.get('c_zip').trim(),
    };
  }

  $('#same-as-customer').addEventListener('change', (e) => {
    if (!e.target.checked) return;
    const f = new FormData($('#order-form'));
    const c = state.customer || customerPayload(f) || {};
    const form = $('#order-form');
    form.r_name.value = c.name || '';
    form.r_phone.value = c.phone || '';
    form.r_address.value = c.address || [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
  });

  // ---------- items ----------
  function addLine() {
    const input = $('#product-search');
    const text = input.value.trim();
    if (!text) return;
    const p = state.products.find((x) => productLabel(x) === text);
    state.lines.push(p
      ? { productId: p.id, name: `${p.name}${p.size ? ` (${p.size})` : ''}`, qty: 1, price: p.price, taxable: p.taxable }
      : { productId: null, name: text, qty: 1, price: 0, taxable: true });
    input.value = '';
    renderLines();
    if (!p) $(`#lines tr:last-child input[data-k="price"]`).focus();
  }
  $('#add-item').addEventListener('click', addLine);
  $('#product-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } });

  function renderLines() {
    $('#lines').innerHTML = state.lines.map((l, i) => `
      <tr data-i="${i}">
        <td><input data-k="name" value="${esc(l.name)}" aria-label="Item"></td>
        <td><input data-k="qty" type="number" min="1" step="1" value="${l.qty}" aria-label="Quantity"></td>
        <td><input data-k="price" type="number" min="0" step="0.01" value="${l.price}" aria-label="Price each"></td>
        <td><input data-k="taxable" type="checkbox" ${l.taxable ? 'checked' : ''} aria-label="Taxable"></td>
        <td><button type="button" class="x" aria-label="Remove">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">No items yet.</td></tr>';
    $$('#lines tr[data-i]').forEach((tr) => {
      const l = state.lines[tr.dataset.i];
      $$('input', tr).forEach((inp) => inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        l[k] = k === 'taxable' ? inp.checked : k === 'name' ? inp.value : Number(inp.value);
        recalc();
      }));
      $('.x', tr).addEventListener('click', () => { state.lines.splice(tr.dataset.i, 1); renderLines(); });
    });
    recalc();
  }

  // Preview only; the server works the totals out again when saving.
  function recalc() {
    const form = $('#order-form');
    const o = state.options || { taxRate: 0 };
    const delivery = form.fulfillment.value === 'Delivery';
    $('#fee-row').hidden = !delivery;
    let sub = 0, taxable = 0;
    for (const l of state.lines) {
      const amt = (Number(l.qty) || 0) * (Number(l.price) || 0);
      sub += amt;
      if (l.taxable) taxable += amt;
    }
    const fee = delivery ? Number(form.deliveryFee.value || 0) : 0;
    const tax = state.customer?.taxExempt ? 0 : Math.round(taxable * o.taxRate * 100) / 100;
    $('#t-sub').textContent = fmt(sub);
    $('#t-fee').textContent = fmt(fee);
    $('#t-tax').textContent = fmt(tax);
    $('#t-total').textContent = fmt(sub + fee + tax);
  }
  $('#order-form').addEventListener('input', (e) => { if (!e.target.closest('#lines')) recalc(); });

  function resetOrder() {
    const form = $('#order-form');
    form.reset();
    const o = state.options;
    fillSelect('#opt-channel', o.channel, 'Phone');
    fillSelect('#opt-brand', o.brand, o.defaultBrand);
    fillSelect('#opt-fulfillment', o.fulfillment, 'Pickup');
    fillSelect('#opt-paymentStatus', o.paymentStatus, 'Unpaid');
    form.deliveryFee.value = state.options.deliveryFee || '';
    form.dueDate.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
    state.lines = [];
    $('#cust-clear').click();
    $('#cust-new').open = false;
    $('#order-error').textContent = '';
    renderLines();
  }

  // ---------- save ----------
  $('#order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    const btn = $('#save-order');
    $('#order-error').textContent = '';
    const body = {
      customer: customerPayload(f),
      channel: f.get('channel'),
      brand: f.get('brand'),
      fulfillment: f.get('fulfillment'),
      occasion: f.get('occasion'),
      dueDate: f.get('dueDate'),
      dueTime: f.get('dueTime'),
      lines: state.lines,
      recipient: { name: f.get('r_name').trim(), phone: f.get('r_phone').trim(), address: f.get('r_address').trim() },
      cardMessage: f.get('cardMessage').trim(),
      paymentStatus: f.get('paymentStatus'),
      stripePaymentId: f.get('stripePaymentId').trim(),
      deliveryFee: f.get('deliveryFee') === '' ? undefined : Number(f.get('deliveryFee')),
      notes: f.get('notes').trim(),
    };
    btn.disabled = true;
    try {
      const r = await api('/orders', { method: 'POST', body });
      toast(`Order ${r.number} saved. Total ${fmt(r.totals.total)}.`);
      resetOrder();
      window.scrollTo(0, 0);
    } catch (err) {
      $('#order-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- order list ----------
  const fulfillClass = (f) => `go-${String(f || 'none').toLowerCase().replace(/[^a-z]+/g, '-')}`;

  // Going-out-by filter chips above the list.
  let goFilter = '';
  function renderFilter() {
    const opts = ['', ...(state.options?.fulfillment || [])];
    $('#go-filter').innerHTML = opts.map((f) => `<button type="button" class="chip ${f === goFilter ? 'on' : ''}" data-f="${esc(f)}">${esc(f || 'All')}</button>`).join('');
    $$('#go-filter .chip').forEach((b) => b.addEventListener('click', () => { goFilter = b.dataset.f; renderFilter(); applyFilter(); }));
  }
  function applyFilter() {
    $$('#orders .order').forEach((el) => { el.hidden = goFilter !== '' && el.dataset.fulfillment !== goFilter; });
  }

  // One 8.5x11 sheet, like the HANA ticket: a three-panel enclosure card across the top
  // (recipient, shop info, card message), then the work ticket and the delivery ticket.
  function printTicket(o) {
    const shop = state.options.shop || {};
    const brand = o.brand || state.options.defaultBrand || '';
    const delivery = o.fulfillment === 'Delivery';
    const notes = String(o.notes || '').split('\n').filter((l) => !/^Taken by:/.test(l)).join('\n');
    const takenBy = (String(o.notes || '').match(/^Taken by: (.*)$/m) || [])[1] || '';
    const msg = o.cardMessage || '';
    const msgSize = msg.length > 220 ? 'sm' : msg.length > 110 ? 'md' : 'lg';
    const addr = (lines) => lines.filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('');
    const row = (label, value) => (value ? `<tr><th>${label}</th><td>${esc(value)}</td></tr>` : '');
    $('#print-area').innerHTML = `
      <div class="sheet">
        <section class="card-strip">
          <div class="panel p-to">
            <div class="p-brand">${esc(brand)}</div>
            ${addr([o.recipient, delivery ? o.address : '', o.recipientPhone ? `Phone: ${o.recipientPhone}` : ''])}
            <div class="p-when">${delivery ? 'Delivery' : esc(o.fulfillment || 'Due')}: <strong>${esc(o.dueLabel || '')}</strong></div>
          </div>
          <div class="panel p-shop">
            <div class="p-brand">${esc(brand)}</div>
            ${addr([shop.address, shop.phone ? `Phone: ${shop.phone}` : '', shop.email, shop.web])}
            <p class="p-care">Dear Valued Customer,<br>${esc(shop.care || '')}</p>
          </div>
          <div class="panel p-msg">
            <div class="p-brand">${esc(brand)}</div>
            <div class="p-text ${msgSize}">${esc(msg)}</div>
          </div>
        </section>

        <section class="tickets">
          <div class="work">
            <div class="w-head"><strong>${esc(o.fulfillment || '')} · ${esc(o.dueLabel || 'No due date')}</strong><strong>#${esc(o.number)}</strong></div>
            <div class="w-cols">
              <div><h4>Recipient</h4>${addr([o.recipient, o.address, o.recipientPhone])}</div>
              <div><h4>Sender</h4>${addr([o.customerName, o.customerPhone])}</div>
              <div class="w-meta">${addr([o.channel ? `Came in by: ${o.channel}` : '', o.occasion ? `Occasion: ${o.occasion}` : '', takenBy ? `Taken by: ${takenBy}` : '', brand])}</div>
            </div>
            <h4>Items</h4>
            <pre>${esc(o.lineItems)}</pre>
            ${notes ? `<h4>Special instructions</h4><pre>${esc(notes)}</pre>` : ''}
            <table class="w-totals">
              ${row('Subtotal', fmt(o.subtotal))}
              ${o.deliveryFee ? row('Delivery fee', fmt(o.deliveryFee)) : ''}
              ${row('Tax', fmt(o.tax))}
              <tr class="tot"><th>Total</th><td>${fmt(o.total)}</td></tr>
              ${row('Payment', o.paymentStatus)}
            </table>
            <div class="w-sign"><span>Designed by ____________</span><span>Checked ____________</span></div>
          </div>
          <div class="deliv">
            <div class="d-title">${delivery ? 'DELIVERY TICKET' : 'PICKUP TICKET'} <span>#${esc(o.number)}</span></div>
            <div class="d-when"><strong>${esc(o.dueLabel || '')}</strong></div>
            ${addr([o.recipient, delivery ? o.address : '', o.recipientPhone ? `Phone: ${o.recipientPhone}` : ''])}
            ${o.occasion ? `<div class="d-gap">Occasion: ${esc(o.occasion)}</div>` : ''}
            ${notes ? `<div class="d-gap">${esc(notes)}</div>` : ''}
            <h4>Product</h4><pre>${esc(o.lineItems.replace(/ @ .*$/gm, ''))}</pre>
            <div class="d-sign"><div>Print name: ________________</div><div>Time: ________________</div></div>
          </div>
        </section>
      </div>`;
    window.print();
  }

  async function loadOrders() {
    const box = $('#orders');
    box.innerHTML = '<p class="muted">Loading...</p>';
    try {
      const list = await api(`/orders${$('#show-done').checked ? '?done=1' : ''}`);
      if (!list.length) { box.innerHTML = '<p class="muted">No open orders.</p>'; return; }
      box.innerHTML = list.map((o) => `
        <article class="order ${fulfillClass(o.fulfillment)}" data-id="${esc(o.id)}" data-fulfillment="${esc(o.fulfillment)}">
          <div>
            <span class="go-tag">${esc(o.fulfillment || 'Not set')}</span>
            <h3>${esc(o.name || o.number)}</h3>
            <div class="muted">${esc(o.dueLabel || 'No due date')}${o.address ? ` · ${esc(o.address)}` : ''}</div>
            <div><span class="pill">${esc(o.brand)}</span><span class="pill ${o.paymentStatus === 'Unpaid' ? 'unpaid' : ''}">${esc(o.paymentStatus)}</span></div>
            <pre>${esc(o.lineItems)}</pre>
            ${o.cardMessage ? `<div class="muted">Card: “${esc(o.cardMessage)}”</div>` : ''}
          </div>
          <div class="side">
            <select data-k="status" aria-label="Status">${state.options.status.map((s) => `<option ${s === o.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
            <select data-k="paymentStatus" aria-label="Payment">${state.options.paymentStatus.map((s) => `<option ${s === o.paymentStatus ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
            <strong>${fmt(o.total)}</strong>
            <button type="button" class="print-btn">Print</button>
          </div>
        </article>`).join('');
      renderFilter();
      applyFilter();
      $$('#orders .print-btn').forEach((b) => b.addEventListener('click', () => {
        printTicket(list.find((o) => o.id === b.closest('.order').dataset.id));
      }));
      $$('#orders select').forEach((sel) => sel.addEventListener('change', async () => {
        const id = sel.closest('.order').dataset.id;
        try {
          await api(`/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { [sel.dataset.k]: sel.value } });
          toast('Updated.');
        } catch (err) {
          toast(err.message);
        }
      }));
    } catch (err) {
      box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }
  $('#refresh').addEventListener('click', loadOrders);
  $('#show-done').addEventListener('change', loadOrders);

  start().catch(() => show('login'));
})();
