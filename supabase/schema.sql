-- Flappy Exu: banco do ranking (Supabase). Cole no SQL Editor do projeto e execute uma vez.
-- RLS ligado e sem policies: ninguém acessa as tabelas direto pela API pública.
-- O servidor (Vercel) usa as funções api_*, que exigem o segredo API_SECRET.
-- O valor abaixo é o SHA-256 do API_SECRET (nunca o segredo em si). Para trocar de segredo:
--   update public.api_config set secret_hash = encode(sha256(convert_to('NOVO_SEGREDO','UTF8')),'hex');

create table public.api_config (
  id int primary key default 1 check (id = 1),
  secret_hash text not null
);
create table public.players (
  nick text primary key check (nick ~ '^[A-Z0-9_ -]{2,12}$'),
  salt text not null,
  hash text not null,
  best int not null default 0,
  best_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index players_rank_idx on public.players (best desc, best_at asc) where best > 0;
create table public.rate_hits (
  key text primary key,
  n int not null default 0,
  expires_at timestamptz not null
);
create table public.used_runs (
  id text primary key,
  created_at timestamptz not null default now()
);

alter table public.api_config enable row level security;
alter table public.players enable row level security;
alter table public.rate_hits enable row level security;
alter table public.used_runs enable row level security;
revoke all on public.api_config, public.players, public.rate_hits, public.used_runs from anon, authenticated;

insert into public.api_config (id, secret_hash) values (1, 'b1d44e31f8e8f4b7a115ebd6a878ecf7eb0053ace4e66030b47e3fcd46bc791d');

create function public.api_guard(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or not exists (
    select 1 from public.api_config
    where secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function public.api_guard(text) from public, anon, authenticated;

create function public.api_register(p_secret text, p_nick text, p_salt text, p_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  perform public.api_guard(p_secret);
  insert into public.players (nick, salt, hash) values (p_nick, p_salt, p_hash) on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

create function public.api_get_player(p_secret text, p_nick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r jsonb;
begin
  perform public.api_guard(p_secret);
  select jsonb_build_object('nick', p.nick, 'salt', p.salt, 'hash', p.hash, 'best', p.best)
    into v_r from public.players p where p.nick = p_nick;
  return v_r;
end $$;

create function public.api_hit(p_secret text, p_key text, p_ttl int) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform public.api_guard(p_secret);
  if random() < 0.02 then delete from public.rate_hits where expires_at < now(); end if;
  insert into public.rate_hits as rh (key, n, expires_at)
  values (p_key, 1, now() + make_interval(secs => p_ttl))
  on conflict (key) do update set
    n = case when rh.expires_at < now() then 1 else rh.n + 1 end,
    expires_at = case when rh.expires_at < now() then now() + make_interval(secs => p_ttl) else rh.expires_at end
  returning n into v_n;
  return v_n;
end $$;

create function public.api_peek(p_secret text, p_key text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform public.api_guard(p_secret);
  select coalesce((select r.n from public.rate_hits r where r.key = p_key and r.expires_at > now()), 0) into v_n;
  return v_n;
end $$;

create function public.api_clear(p_secret text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.api_guard(p_secret);
  delete from public.rate_hits where key = p_key;
end $$;

create function public.api_use_run(p_secret text, p_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  perform public.api_guard(p_secret);
  if random() < 0.02 then delete from public.used_runs where created_at < now() - interval '7 hours'; end if;
  insert into public.used_runs (id) values (p_id) on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

create function public.api_submit(p_secret text, p_nick text, p_score int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_best int; v_improved boolean := false; v_pos int; v_at timestamptz;
begin
  perform public.api_guard(p_secret);
  update public.players set best = p_score, best_at = now()
    where nick = p_nick and best < p_score
    returning best, best_at into v_best, v_at;
  if found then
    v_improved := true;
  else
    select p.best, p.best_at into v_best, v_at from public.players p where p.nick = p_nick;
    if not found then raise exception 'no_player'; end if;
  end if;
  if v_best > 0 then
    select count(*) + 1 into v_pos from public.players p
      where p.best > v_best or (p.best = v_best and p.best_at < v_at);
  end if;
  return jsonb_build_object('best', v_best, 'improved', v_improved, 'pos', v_pos);
end $$;

create function public.api_ranking(p_secret text, p_limit int default 30) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r jsonb;
begin
  perform public.api_guard(p_secret);
  select coalesce(jsonb_agg(jsonb_build_object('nick', t.nick, 'best', t.best) order by t.best desc, t.best_at asc), '[]'::jsonb)
    into v_r
    from (select p.nick, p.best, p.best_at from public.players p where p.best > 0
          order by p.best desc, p.best_at asc limit least(greatest(p_limit, 1), 100)) t;
  return v_r;
end $$;

revoke all on function public.api_register(text, text, text, text) from public;
revoke all on function public.api_get_player(text, text) from public;
revoke all on function public.api_hit(text, text, int) from public;
revoke all on function public.api_peek(text, text) from public;
revoke all on function public.api_clear(text, text) from public;
revoke all on function public.api_use_run(text, text) from public;
revoke all on function public.api_submit(text, text, int) from public;
revoke all on function public.api_ranking(text, int) from public;
grant execute on function public.api_register(text, text, text, text) to anon;
grant execute on function public.api_get_player(text, text) to anon;
grant execute on function public.api_hit(text, text, int) to anon;
grant execute on function public.api_peek(text, text) to anon;
grant execute on function public.api_clear(text, text) to anon;
grant execute on function public.api_use_run(text, text) to anon;
grant execute on function public.api_submit(text, text, int) to anon;
grant execute on function public.api_ranking(text, int) to anon;
