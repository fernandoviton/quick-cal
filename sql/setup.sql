-- Quick Cal database setup
-- Run this in the Supabase SQL Editor. Re-running it drops all calendar data.
--
-- Security model (no accounts):
--   * Every calendar is identified by a random 128-bit token that only lives in
--     the share link's URL fragment. Each participant gets their own random
--     member key, and the creator gets an admin key.
--   * Only SHA-256 hashes of those secrets are stored.
--   * The tables have RLS enabled with NO policies, and anon/authenticated hold
--     no table privileges. The public API key can therefore only call the
--     SECURITY DEFINER functions below, each of which demands the right secret.
--     There is no way to list or enumerate calendars.

drop table if exists quickcal_availability, quickcal_members, quickcal_calendars cascade;

create table quickcal_calendars (
    id uuid default gen_random_uuid() primary key,
    token_hash bytea not null unique,
    admin_hash bytea not null,
    title text not null,
    created_at timestamptz not null default now(),
    -- Bumped on every change; clients poll it to know when to refetch.
    updated_at timestamptz not null default now()
);

create table quickcal_members (
    id uuid default gen_random_uuid() primary key,
    calendar_id uuid not null references quickcal_calendars(id) on delete cascade,
    name text not null,
    key_hash bytea not null,
    created_at timestamptz not null default now()
);
create index idx_quickcal_members_calendar on quickcal_members(calendar_id);

create table quickcal_availability (
    member_id uuid not null references quickcal_members(id) on delete cascade,
    day date not null,
    status text not null check (status in ('yes', 'maybe')),
    primary key (member_id, day)
);

alter table quickcal_calendars enable row level security;
alter table quickcal_members enable row level security;
alter table quickcal_availability enable row level security;

revoke all on quickcal_calendars, quickcal_members, quickcal_availability from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

create or replace function public.quickcal_hash(p text)
returns bytea language sql immutable set search_path = '' as $$
    select pg_catalog.sha256(pg_catalog.convert_to(p, 'UTF8'));
$$;

-- Secrets are base64url strings of at least 128 bits (22 chars).
create or replace function public.quickcal_check_secret(p text)
returns void language plpgsql set search_path = '' as $$
begin
    if p is null or p !~ '^[A-Za-z0-9_-]{22,64}$' then
        raise exception 'invalid_token';
    end if;
end;
$$;

-- Trims and validates a user-supplied label (calendar title or member name).
create or replace function public.quickcal_clean(p text, max_len int)
returns text language plpgsql set search_path = '' as $$
declare
    v text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g'));
begin
    if v = '' or pg_catalog.char_length(v) > max_len then
        raise exception 'invalid_name';
    end if;
    return v;
end;
$$;

create or replace function public.quickcal_calendar_id(p_token text)
returns uuid language plpgsql set search_path = '' as $$
declare
    v uuid;
begin
    perform public.quickcal_check_secret(p_token);
    select id into v from public.quickcal_calendars where token_hash = public.quickcal_hash(p_token);
    if v is null then
        raise exception 'not_found';
    end if;
    return v;
end;
$$;

create or replace function public.quickcal_check_member(p_cal uuid, p_member_id uuid, p_member_key text)
returns void language plpgsql set search_path = '' as $$
begin
    if p_member_key is null or not exists (
        select 1 from public.quickcal_members
        where id = p_member_id and calendar_id = p_cal and key_hash = public.quickcal_hash(p_member_key)
    ) then
        raise exception 'forbidden';
    end if;
end;
$$;

create or replace function public.quickcal_check_admin(p_cal uuid, p_admin_key text)
returns void language plpgsql set search_path = '' as $$
begin
    if p_admin_key is null or not exists (
        select 1 from public.quickcal_calendars
        where id = p_cal and admin_hash = public.quickcal_hash(p_admin_key)
    ) then
        raise exception 'forbidden';
    end if;
end;
$$;

create or replace function public.quickcal_touch(p_cal uuid)
returns void language sql set search_path = '' as $$
    update public.quickcal_calendars set updated_at = pg_catalog.clock_timestamp() where id = p_cal;
$$;

-- ---------------------------------------------------------------------------
-- Public RPC API (called via supabase.rpc('quickcal_*'))
-- ---------------------------------------------------------------------------

create or replace function public.quickcal_create(p_token text, p_admin_key text, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
    perform public.quickcal_check_secret(p_token);
    perform public.quickcal_check_secret(p_admin_key);
    insert into public.quickcal_calendars (token_hash, admin_hash, title)
    values (public.quickcal_hash(p_token), public.quickcal_hash(p_admin_key), public.quickcal_clean(p_title, 80));
end;
$$;

-- Cheap change marker for polling. Same string format as quickcal_get's updated_at.
create or replace function public.quickcal_version(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    return (select pg_catalog.to_jsonb(updated_at) #>> '{}' from public.quickcal_calendars where id = cal);
end;
$$;

create or replace function public.quickcal_get(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    return (
        select pg_catalog.jsonb_build_object(
            'title', c.title,
            'updated_at', pg_catalog.to_jsonb(c.updated_at) #>> '{}',
            'members', coalesce((
                select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', m.id, 'name', m.name) order by m.created_at, m.id)
                from public.quickcal_members m where m.calendar_id = cal
            ), '[]'::jsonb),
            'availability', coalesce((
                select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('member_id', a.member_id, 'day', a.day, 'status', a.status) order by a.day, a.member_id)
                from public.quickcal_availability a
                join public.quickcal_members m on m.id = a.member_id
                where m.calendar_id = cal
            ), '[]'::jsonb)
        )
        from public.quickcal_calendars c where c.id = cal
    );
end;
$$;

create or replace function public.quickcal_join(p_token text, p_name text, p_member_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
    v uuid;
begin
    perform public.quickcal_check_secret(p_member_key);
    -- Serialize joins per calendar so the member cap holds under concurrency.
    perform 1 from public.quickcal_calendars where id = cal for update;
    if (select count(*) from public.quickcal_members where calendar_id = cal) >= 50 then
        raise exception 'limit';
    end if;
    insert into public.quickcal_members (calendar_id, name, key_hash)
    values (cal, public.quickcal_clean(p_name, 40), public.quickcal_hash(p_member_key))
    returning id into v;
    perform public.quickcal_touch(cal);
    return v;
end;
$$;

create or replace function public.quickcal_rename_member(p_token text, p_member_id uuid, p_member_key text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    perform public.quickcal_check_member(cal, p_member_id, p_member_key);
    update public.quickcal_members set name = public.quickcal_clean(p_name, 40) where id = p_member_id;
    perform public.quickcal_touch(cal);
end;
$$;

create or replace function public.quickcal_leave(p_token text, p_member_id uuid, p_member_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    perform public.quickcal_check_member(cal, p_member_id, p_member_key);
    delete from public.quickcal_members where id = p_member_id;
    perform public.quickcal_touch(cal);
end;
$$;

-- Sets (p_status 'yes' / 'maybe') or clears (p_status null) a batch of days.
create or replace function public.quickcal_set_days(p_token text, p_member_id uuid, p_member_key text, p_days date[], p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    perform public.quickcal_check_member(cal, p_member_id, p_member_key);
    if p_days is null or pg_catalog.cardinality(p_days) = 0 or pg_catalog.cardinality(p_days) > 366
        or exists (select 1 from pg_catalog.unnest(p_days) d where d is null or d < current_date - 400 or d > current_date + 800)
    then
        raise exception 'invalid_days';
    end if;

    if p_status is null then
        delete from public.quickcal_availability where member_id = p_member_id and day = any(p_days);
    elsif p_status in ('yes', 'maybe') then
        insert into public.quickcal_availability (member_id, day, status)
        select distinct p_member_id, d, p_status from pg_catalog.unnest(p_days) d
        on conflict (member_id, day) do update set status = excluded.status;
        if (select count(*) from public.quickcal_availability where member_id = p_member_id) > 1000 then
            raise exception 'limit';
        end if;
    else
        raise exception 'invalid_status';
    end if;
    perform public.quickcal_touch(cal);
end;
$$;

create or replace function public.quickcal_admin_check(p_token text, p_admin_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    return p_admin_key is not null and exists (
        select 1 from public.quickcal_calendars where id = cal and admin_hash = public.quickcal_hash(p_admin_key)
    );
end;
$$;

create or replace function public.quickcal_admin_rename(p_token text, p_admin_key text, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    perform public.quickcal_check_admin(cal, p_admin_key);
    update public.quickcal_calendars set title = public.quickcal_clean(p_title, 80) where id = cal;
    perform public.quickcal_touch(cal);
end;
$$;

create or replace function public.quickcal_admin_remove_member(p_token text, p_admin_key text, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    perform public.quickcal_check_admin(cal, p_admin_key);
    delete from public.quickcal_members where id = p_member_id and calendar_id = cal;
    perform public.quickcal_touch(cal);
end;
$$;

create or replace function public.quickcal_admin_delete(p_token text, p_admin_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
    cal uuid := public.quickcal_calendar_id(p_token);
begin
    perform public.quickcal_check_admin(cal, p_admin_key);
    delete from public.quickcal_calendars where id = cal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: Supabase grants EXECUTE on new public functions to anon and
-- authenticated by default, so revoke everything and re-grant only the API.
-- ---------------------------------------------------------------------------

revoke all on function
    public.quickcal_hash(text),
    public.quickcal_check_secret(text),
    public.quickcal_clean(text, int),
    public.quickcal_calendar_id(text),
    public.quickcal_check_member(uuid, uuid, text),
    public.quickcal_check_admin(uuid, text),
    public.quickcal_touch(uuid),
    public.quickcal_create(text, text, text),
    public.quickcal_version(text),
    public.quickcal_get(text),
    public.quickcal_join(text, text, text),
    public.quickcal_rename_member(text, uuid, text, text),
    public.quickcal_leave(text, uuid, text),
    public.quickcal_set_days(text, uuid, text, date[], text),
    public.quickcal_admin_check(text, text),
    public.quickcal_admin_rename(text, text, text),
    public.quickcal_admin_remove_member(text, text, uuid),
    public.quickcal_admin_delete(text, text)
from public, anon, authenticated;

grant execute on function
    public.quickcal_create(text, text, text),
    public.quickcal_version(text),
    public.quickcal_get(text),
    public.quickcal_join(text, text, text),
    public.quickcal_rename_member(text, uuid, text, text),
    public.quickcal_leave(text, uuid, text),
    public.quickcal_set_days(text, uuid, text, date[], text),
    public.quickcal_admin_check(text, text),
    public.quickcal_admin_rename(text, text, text),
    public.quickcal_admin_remove_member(text, text, uuid),
    public.quickcal_admin_delete(text, text)
to anon, authenticated;
