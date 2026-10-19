-- Migration 001: add the generated content_date column + composite index to an
-- existing table created by a pre-date-range setup.sql. New installs get this
-- from setup.sql directly; run this only on a live table you don't want to drop.
--
-- Replace listlet_sample with your app's DB_TABLE if it differs.

create or replace function listlet_content_date(content text)
returns date immutable language plpgsql as $$
begin
    return (nullif(content, '')::jsonb ->> 'date')::date;
exception when others then
    return null;
end;
$$;

alter table listlet_sample
    add column if not exists content_date date
    generated always as (listlet_content_date(content)) stored;

create index if not exists idx_listlet_sample_list_name_date
    on listlet_sample(list_name, content_date);
