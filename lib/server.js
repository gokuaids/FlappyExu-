'use strict';
/* Utilitários do servidor: Supabase (funções SQL protegidas por segredo), tokens assinados, senhas e wrapper de rotas. */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const PTS = 8;                      // pontos por fase (igual ao jogo)
const AUTH_TTL = 90 * 864e5;        // login vale 90 dias
const RUN_TTL = 6 * 3600e3;         // uma partida vale até 6 horas

const fail = (http, code) => { const e = new Error(code); e.http = http; e.code = code; return e; };

/* Chama uma função SQL do Supabase (schema public, prefixo api_). Todas exigem API_SECRET, que só o servidor conhece. */
async function rpc(fn, args) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY, sec = process.env.API_SECRET;
  if (!url || !key || !sec) throw fail(500, 'config');
  const headers = { 'content-type': 'application/json', apikey: key };
  if (key.startsWith('eyJ')) headers.authorization = 'Bearer ' + key; // chave legada (JWT)
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers, body: JSON.stringify({ p_secret: sec, ...args }), signal: ctl.signal
    });
    const txt = await r.text();
    if (!r.ok) { console.error('supabase', fn, r.status, txt.slice(0, 300)); throw fail(500, 'server'); }
    return txt ? JSON.parse(txt) : null;
  } finally { clearTimeout(tm); }
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw fail(500, 'config');
  return s;
}

/* Tokens: base64url(payload).HMAC */
function sign(p) {
  const s = Buffer.from(JSON.stringify(p)).toString('base64url');
  return s + '.' + crypto.createHmac('sha256', secret()).update(s).digest('base64url');
}
function verify(t) {
  if (typeof t !== 'string') return null;
  const [s, m] = t.split('.');
  if (!s || !m) return null;
  const e = crypto.createHmac('sha256', secret()).update(s).digest('base64url');
  const a = Buffer.from(m), b = Buffer.from(e);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(s, 'base64url').toString());
    if (!p || (p.e && p.e < Date.now())) return null;
    return p;
  } catch { return null; }
}

/* Nome e senha */
function cleanNick(v) {
  const n = String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
  return /^[A-Z0-9_ -]{2,12}$/.test(n) ? n : null;
}
const validPw = p => typeof p === 'string' && p.length >= 4 && p.length <= 64;
const hashPw = async (pw, salt) => (await scrypt(pw, salt, 32)).toString('base64url');
async function checkPw(pw, u) {
  const h = Buffer.from(await hashPw(pw, u.salt)), e = Buffer.from(u.hash);
  return h.length === e.length && crypto.timingSafeEqual(h, e);
}

/* Jogadores: tabela public.players. getUser devolve {nick,salt,hash,best} ou null */
const getUser = nick => rpc('api_get_player', { p_nick: nick });

async function authUser(req) {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) return null;
  const p = verify(h.slice(7));
  if (!p || p.typ !== 'auth' || !p.k) return null;
  return getUser(p.k);
}
async function requireUser(req) {
  const u = await authUser(req);
  if (!u) throw fail(401, 'unauth');
  return u;
}

/* Limite simples por chave (true = ainda dentro do limite) */
async function limit(key, max, ttl) {
  return (await rpc('api_hit', { p_key: key, p_ttl: ttl })) <= max;
}

const ip = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || (req.socket && req.socket.remoteAddress) || 'x';

function bodyOf(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

const handler = (methods, fn) => async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    return res.status(405).json({ error: 'method' });
  }
  try { await fn(req, res); }
  catch (e) {
    if (e && e.http) return res.status(e.http).json({ error: e.code });
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
};

module.exports = {
  PTS, AUTH_TTL, RUN_TTL, fail, rpc, sign, verify, cleanNick, validPw, hashPw, checkPw,
  getUser, authUser, requireUser, limit, ip, bodyOf, handler
};
