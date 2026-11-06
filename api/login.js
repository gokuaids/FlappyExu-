'use strict';
const { rpc, handler, fail, bodyOf, cleanNick, checkPw, getUser, sign, AUTH_TTL } = require('../lib/server');

module.exports = handler(['POST'], async (req, res) => {
  const b = bodyOf(req), nick = cleanNick(b.nick);
  if (!nick || typeof b.password !== 'string' || b.password.length > 64) throw fail(401, 'invalid');
  const fk = 'fail:' + nick;
  if ((await rpc('api_peek', { p_key: fk })) >= 8) throw fail(429, 'locked');
  const u = await getUser(nick);
  if (!u || !(await checkPw(b.password, u))) {
    await rpc('api_hit', { p_key: fk, p_ttl: 600 });
    throw fail(401, 'invalid');
  }
  await rpc('api_clear', { p_key: fk });
  res.json({ token: sign({ typ: 'auth', k: u.nick, e: Date.now() + AUTH_TTL }), me: { nick: u.nick, best: u.best || 0 } });
});
