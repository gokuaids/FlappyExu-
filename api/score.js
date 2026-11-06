'use strict';
const { rpc, handler, fail, bodyOf, requireUser, verify } = require('../lib/server');

/* Velocidade máxima do jogo: 180 px/s com canos a cada 172 px = 1 ponto a cada ~0,95 s. */
const SEG_POR_PONTO = 0.9;

module.exports = handler(['POST'], async (req, res) => {
  const u = await requireUser(req), b = bodyOf(req), sc = b.score;
  if (!Number.isInteger(sc) || sc < 1 || sc > 100000) throw fail(400, 'bad_score');

  const r = verify(b.run);
  if (!r || r.typ !== 'run' || r.k !== u.nick) throw fail(400, 'bad_run');
  const elapsed = (Date.now() - r.t) / 1000;
  if (sc > Math.floor(elapsed / SEG_POR_PONTO) + 2) throw fail(400, 'suspicious');

  // cada partida só pode ser enviada uma vez
  if (!(await rpc('api_use_run', { p_id: String(b.run).split('.')[1] }))) throw fail(400, 'bad_run');

  const out = await rpc('api_submit', { p_nick: u.nick, p_score: sc });
  res.json({ best: out.best || 0, improved: !!out.improved, pos: out.pos || null });
});
