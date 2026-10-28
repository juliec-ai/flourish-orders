// Staff login: email + PIN, checked against STAFF_USERS, with a signed session cookie.
const crypto = require('crypto');

const COOKIE = 'fo_session';
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function checkPin(pin, stored) {
  const [scheme, salt, hash] = String(stored || '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(String(pin), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function loadStaff() {
  let list;
  try {
    list = JSON.parse(process.env.STAFF_USERS || '[]');
  } catch {
    throw new Error('STAFF_USERS is not valid JSON');
  }
  return list.map((s) => ({ ...s, email: String(s.email).toLowerCase() }));
}

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, secret) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function createAuth({ secret, staff, secure }) {
  const fails = new Map(); // email -> { count, until }

  function setCookie(res, value, maxAgeSec) {
    const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function login(req, res) {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const pin = String(req.body?.pin || '').trim();
    const f = fails.get(email);
    if (f && f.until > Date.now()) {
      return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
    }
    const user = staff.find((s) => s.email === email);
    if (!user || !checkPin(pin, user.pin)) {
      const count = (f && f.until > Date.now() ? 0 : f?.count || 0) + 1;
      fails.set(email, { count, until: count >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60e3 : 0 });
      return res.status(401).json({ error: 'Email or PIN is not right.' });
    }
    fails.delete(email);
    const token = sign({ email: user.email, name: user.name, exp: Date.now() + SESSION_HOURS * 3600e3 }, secret);
    setCookie(res, token, SESSION_HOURS * 3600);
    res.json({ name: user.name });
  }

  function logout(req, res) {
    setCookie(res, '', 0);
    res.json({ ok: true });
  }

  function requireStaff(req, res, next) {
    const session = verify(readCookie(req, COOKIE), secret);
    const user = session && staff.find((s) => s.email === session.email);
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    req.staff = user;
    next();
  }

  return { login, logout, requireStaff };
}

module.exports = { hashPin, checkPin, loadStaff, createAuth, sign, verify };
