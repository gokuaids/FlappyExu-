'use strict';
const crypto = require('node:crypto');
const { rpc, handler, fail, bodyOf, cleanNick, validPw, hashPw, sign, ip, limit, AUTH_TTL } = require('../lib/server');

module.exports = handler(['POST'], async (req, res) => {
  const b = bodyOf(req), nick = cleanNick(b.nick);
  if (!nick) throw fail(400, 'bad_nick');
  if (!validPw(b.password)) throw fail(400, 'bad_pass');
  if (!(await limit('rl:reg:' + ip(req), 5, 3600))) throw fail(429, 'limit');
  const salt = crypto.randomBytes(16).toString('base64url');
  const ok = await rpc('api_register', { p_nick: nick, p_salt: salt, p_hash: await hashPw(b.password, salt) });
  if (!ok) throw fail(409, 'taken');
  res.status(201).json({ token: sign({ typ: 'auth', k: nick, e: Date.now() + AUTH_TTL }), me: { nick, best: 0 } });
});
