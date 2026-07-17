-- swear-jar leaderboard funnel — the database.
--
-- Three tables, one job each:
--   entries        a confirmed leaderboard entry. THIS IS CUSTOMER DATA — a real
--                  person typed their email and handle into a form. It is never
--                  hard-deleted (see the trigger below); it is hidden.
--   pending        an unconfirmed submission awaiting its email click. Ephemeral,
--                  self-expiring, hard-deletable — nobody has agreed to anything yet.
--   rate_limits    per-IP / per-email counters. Ephemeral, hard-deletable.
--
-- The public board reads `board` (a view exposing ONLY publishable columns).
-- The email never leaves the server: it is not in the view, so an anon client
-- cannot select it even if a policy were wrong.

create extension if not exists pgcrypto;

-- ── entries: the customer rows ───────────────────────────────────────────────
create table if not exists public.entries (
  email             text primary key,          -- normalized; the identity of an entry
  handle            text not null,             -- sanitized display name (shown)
  stats             jsonb not null,            -- the validated aggregate numbers
  join_list         boolean not null default false,
  verified          boolean not null default false,
  release_hash      text,
  app_version       text,
  confirmed_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- soft-delete trio: hidden, never destroyed
  deleted_at        timestamptz,
  deleted_by        text,
  deletion_reason   text
);

create index if not exists entries_live_idx on public.entries (confirmed_at desc)
  where deleted_at is null;

-- NO HARD DELETE. This fires regardless of role, RLS, or grants — the trigger IS
-- the policy. Hiding an entry means setting deleted_at (see soft_delete_entry).
-- A genuine erasure request is the only legitimate exception: drop the trigger
-- deliberately, delete with an audit record, put it back.
create or replace function public.block_entries_hard_delete()
returns trigger language plpgsql as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'entries rows are customer submissions and are never hard-deleted',
    hint    = 'use soft_delete_entry(email, actor, reason) — it hides the row and records who/when/why';
end;
$$;

drop trigger if exists block_entries_hard_delete on public.entries;
create trigger block_entries_hard_delete
  before delete on public.entries
  for each row execute function public.block_entries_hard_delete();

-- The ONLY supported way to remove someone from the board.
create or replace function public.soft_delete_entry(p_email text, p_actor text, p_reason text)
returns void language sql security definer set search_path = public as $$
  update public.entries
     set deleted_at = now(), deleted_by = p_actor, deletion_reason = p_reason
   where email = p_email and deleted_at is null;
$$;

-- ── pending: unconfirmed, self-expiring ──────────────────────────────────────
create table if not exists public.pending (
  token        text primary key,
  email        text not null,
  handle       text not null,
  stats        jsonb not null,
  join_list    boolean not null default false,
  release_hash text,
  app_version  text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists pending_expires_idx on public.pending (expires_at);

-- ── rate_limits: counters, self-expiring ─────────────────────────────────────
create table if not exists public.rate_limits (
  key        text primary key,
  count      integer not null default 0,
  expires_at timestamptz not null
);
create index if not exists rate_limits_expires_idx on public.rate_limits (expires_at);

-- Atomic bump: one round-trip, no read-modify-write race between concurrent
-- submissions. Returns the count AFTER this hit, which is what the caller
-- compares against the limit.
create or replace function public.bump_rate_limit(p_key text, p_ttl_seconds integer)
returns integer language plpgsql as $$
declare v_count integer;
begin
  delete from public.rate_limits where key = p_key and expires_at <= now();
  insert into public.rate_limits (key, count, expires_at)
       values (p_key, 1, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update set count = public.rate_limits.count + 1
    returning count into v_count;
  return v_count;
end;
$$;

-- Reclaim expired ephemeral rows. Expiry is ENFORCED ON READ everywhere, so this
-- is housekeeping, not correctness: an expired token is unusable the moment it
-- expires, whether or not this has run.
create or replace function public.sweep_expired()
returns void language sql as $$
  delete from public.pending where expires_at <= now();
  delete from public.rate_limits where expires_at <= now();
$$;

-- ── the public board ─────────────────────────────────────────────────────────
-- Publishable columns ONLY. Email, join_list and the soft-delete bookkeeping are
-- structurally absent: this is the allow-list, enforced by the database rather
-- than by application code remembering to strip fields.
create or replace view public.board
with (security_invoker = true) as
  select handle,
         (stats->>'total_coins')::numeric    as total_coins,
         (stats->>'dollars')::numeric        as dollars,
         (stats->>'swears_per_day')::numeric as swears_per_day,
         (stats->>'fbomb_pct')::numeric      as fbomb_pct,
         (stats->>'active_days')::numeric    as active_days,
         stats->>'top_word'                  as top_word,
         app_version,
         verified,
         confirmed_at::date                  as submitted
    from public.entries
   where deleted_at is null;

-- ── RLS: deny by default ─────────────────────────────────────────────────────
-- The funnel service talks to Postgres with the service role, which bypasses
-- RLS. These policies govern anon/authenticated — i.e. anyone who finds the
-- project URL and the publishable anon key. They get the board and nothing else.
alter table public.entries     enable row level security;
alter table public.pending     enable row level security;
alter table public.rate_limits enable row level security;

-- No policies on entries/pending/rate_limits at all: RLS on + zero policies =
-- anon can read nothing and write nothing. The board view is reachable because
-- it is security_invoker=false-free (see grant below) and selects only public
-- columns from rows the view itself filters.
revoke all on public.entries     from anon, authenticated;
revoke all on public.pending     from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;

-- The board view runs as its owner, so it can read entries while anon cannot.
alter view public.board set (security_invoker = false);
grant select on public.board to anon, authenticated;
