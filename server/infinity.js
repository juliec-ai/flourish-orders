// Thin Infinity API client. Looks attributes up by name so the code
// keeps working if fields are reordered or recreated on the boards.
const BASE = 'https://app.startinfinity.com/api/v2';
const API_VERSION = '2025-12-01.morava';

class InfinityError extends Error {
  constructor(status, body) {
    super(`Infinity API ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

function createInfinity({ token, workspace, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${BASE}/workspaces/${workspace}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-API-Version': API_VERSION,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new InfinityError(res.status, data);
    return data;
  }

  const schemaCache = new Map();

  // { folderId, byName: { Name: { id, type, labels: { labelName: labelId } } } }
  async function schema(board) {
    if (schemaCache.has(board)) return schemaCache.get(board);
    const [attrs, folders] = await Promise.all([
      call('GET', `/boards/${board}/attributes?limit=100`),
      call('GET', `/boards/${board}/folders?limit=100`),
    ]);
    const byName = {};
    for (const a of attrs.data) {
      const labels = {};
      for (const l of a.settings?.labels || []) labels[l.name] = l.id;
      byName[a.name] = { id: a.id, type: a.type, labels };
    }
    const s = { folderId: folders.data[0]?.id, byName };
    schemaCache.set(board, s);
    return s;
  }

  async function listItems(board, { max = 1000 } = {}) {
    const out = [];
    let after = '';
    while (out.length < max) {
      const q = new URLSearchParams({ limit: '100', 'expand[]': 'values' });
      if (after) q.set('after', after);
      const page = await call('GET', `/boards/${board}/items?${q}`);
      out.push(...page.data.filter((i) => !i.deleted));
      if (!page.has_more || !page.after) break;
      after = page.after;
    }
    return out;
  }

  // Turns an item's values into { 'Attribute Name': value }, with labels as names.
  async function flatten(board, item) {
    const s = await schema(board);
    const byId = {};
    for (const [name, a] of Object.entries(s.byName)) byId[a.id] = { name, ...a };
    const out = { id: item.id, created_at: item.created_at };
    for (const v of item.values || []) {
      const a = byId[v.attribute_id ?? v.attribute?.id];
      if (!a) continue;
      if (a.type === 'label') {
        const names = Object.fromEntries(Object.entries(a.labels).map(([n, id]) => [id, n]));
        out[a.name] = (v.data || []).map((id) => names[id]).filter(Boolean);
      } else {
        out[a.name] = v.data;
      }
    }
    return out;
  }

  // Builds the values array for a create/update from { 'Attribute Name': value }.
  // Label values are given by label name; empty values are skipped.
  async function toValues(board, fields) {
    const s = await schema(board);
    const values = [];
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
      const a = s.byName[name];
      if (!a) throw new Error(`Board ${board} has no field "${name}"`);
      let data = value;
      if (a.type === 'label') {
        const names = Array.isArray(value) ? value : [value];
        data = names.map((n) => {
          if (!a.labels[n]) throw new Error(`"${n}" is not an option for ${name}`);
          return a.labels[n];
        });
      } else if (a.type === 'reference' || a.type === 'members') {
        data = Array.isArray(value) ? value : [value];
      } else if (a.type === 'number') {
        data = Number(value);
      } else if (a.type === 'checkbox') {
        data = Boolean(value);
      }
      values.push({ attribute_id: a.id, data });
    }
    return values;
  }

  async function createItem(board, fields) {
    const s = await schema(board);
    const values = await toValues(board, fields);
    return call('POST', `/boards/${board}/items`, { folder_id: s.folderId, values });
  }

  async function updateItem(board, itemId, fields) {
    const values = await toValues(board, fields);
    return call('PUT', `/boards/${board}/items/${itemId}`, { values });
  }

  return { call, schema, listItems, flatten, toValues, createItem, updateItem };
}

module.exports = { createInfinity, InfinityError };
