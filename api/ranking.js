'use strict';
const { rpc, handler, authUser, PTS } = require('../lib/server');

module.exports = handler(['GET'], async (req, res) => {
  const [me, list] = await Promise.all([authUser(req), rpc('api_ranking', { p_limit: 30 })]);
  const rows = (list || []).filter(u => u && u.best > 0).map(u => ({
    nick: u.nick,
    best: u.best,
    fase: 1 + Math.floor(u.best / PTS),
    me: !!me && me.nick === u.nick
  }));
  res.json({ rows, me: me ? { nick: me.nick, best: me.best || 0 } : null });
});
