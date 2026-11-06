'use strict';
const crypto = require('node:crypto');
const { handler, requireUser, sign, RUN_TTL } = require('../lib/server');

/* Chamado no primeiro toque de cada partida: devolve um "bilhete" assinado com a hora de início.
   O servidor usa esse horário para recusar pontuações impossíveis. */
module.exports = handler(['POST'], async (req, res) => {
  const u = await requireUser(req);
  const now = Date.now();
  res.json({ run: sign({ typ: 'run', k: u.nick, t: now, n: crypto.randomBytes(8).toString('hex'), e: now + RUN_TTL }) });
});
