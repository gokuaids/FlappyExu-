# Flappy Exu — ranking global (Vercel + Supabase)

O jogo fica em `public/index.html`. O ranking usa funções serverless em `api/` e um banco Postgres no Supabase.

## Publicar

1. **Banco:** no Supabase (projeto FlappyExu), abra o **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e execute uma vez.
2. **Variáveis na Vercel** (Settings → Environment Variables):

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | URL do projeto, ex. `https://xxxx.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | chave `sb_publishable_...` (Project Settings → API Keys) |
| `API_SECRET` | segredo cujo SHA-256 está em `schema.sql` (a Vercel já recebe o valor certo) |
| `AUTH_SECRET` | texto aleatório grande, usado para assinar o login dos jogadores |

3. Suba o código no GitHub (ou faça novo deploy) e **Redeploy** o projeto.

## Como funciona

- **Conta:** nome (2 a 12 letras/números) e senha (4 a 64 caracteres). A senha é guardada com hash (scrypt); o login fica salvo no navegador por 90 dias.
- **Ranking:** top 30 por recorde, atualizado enquanto a tela está aberta. Em empate, quem chegou primeiro fica na frente.
- **Só conta quem está logado:** pontos feitos sem conta não entram no ranking.
- **Banco fechado:** as tabelas têm RLS ligado e sem policies, então a chave publicável não lê nada direto. O servidor usa funções SQL `api_*` que exigem o `API_SECRET`; sem ele, o banco recusa.
- **Trapaça:** cada partida pede um bilhete ao servidor no primeiro toque; o servidor compara com o tempo real (máx. ~1 ponto por segundo) e cada bilhete só vale uma vez. Bloqueio de 10 min após 8 senhas erradas e limite de 5 contas por hora por IP.

## Estrutura

```
public/index.html     o jogo
api/register.js       criar conta
api/login.js          entrar
api/run.js            bilhete de início de partida
api/score.js          salvar pontuação
api/ranking.js        top 30 + dados da conta logada
lib/server.js         chamadas ao Supabase, tokens e senhas
supabase/schema.sql   tabelas e funções do banco
```
