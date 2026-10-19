-- Listlet shared database setup
-- Run this in Supabase SQL Editor

drop table if exists quickcal cascade;

-- Derive a row's calendar date from its JSON content. IMMUTABLE so it can back
-- a generated column; the exception guard means a non-JSON / dateless row (the
-- '' default, anything malformed) degrades to NULL instead of blocking the
-- write. Backs the optional date-range fetch in shared/api.js.
create or replace function listlet_content_date(content text)
returns date immutable language plpgsql as $$
begin
    return (nullif(content, '')::jsonb ->> 'date')::date;
exception when others then
    return null;
end;
$$;

create table quickcal (
    id uuid default gen_random_uuid() primary key,
    list_name text not null,
    content text not null default '',
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    -- Generated, content-derived index column. `content` stays the single
    -- writable source of truth; this is a read-only projection used for dated
    -- range queries (api.js fetchItems({dateFrom, dateTo})). STORED so it is
    -- indexed.
    content_date date generated always as (listlet_content_date(content)) stored
);
create index idx_quickcal_list_name on quickcal(list_name);
create index idx_quickcal_list_name_date on quickcal(list_name, content_date);

-- Auto-update updated_at on changes
create or replace function update_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists quickcal_updated_at on quickcal;
create trigger quickcal_updated_at
    before update on quickcal
    for each row
    execute function update_updated_at();

-- Row Level Security
alter table quickcal enable row level security;

create policy "Authenticated users can read all items"
    on quickcal for select
    to authenticated
    using (true);

create policy "Authenticated users can insert items"
    on quickcal for insert
    to authenticated
    with check (true);

create policy "Authenticated users can update items"
    on quickcal for update
    to authenticated
    using (true);

create policy "Authenticated users can delete items"
    on quickcal for delete
    to authenticated
    using (true);

-- Enable Realtime
alter publication supabase_realtime add table quickcal;
