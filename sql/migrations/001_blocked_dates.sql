-- Switches an existing Quick Cal database from "available" marks to "busy"
-- (blocked) marks. Old "available" marks mean nothing in the new model, so
-- they're dropped. "Maybe" marks are kept. A fresh install doesn't need this
-- because sql/setup.sql already has the new rules.

delete from public.quickcal_availability where status = 'yes';

alter table public.quickcal_availability
    drop constraint quickcal_availability_status_check,
    add constraint quickcal_availability_status_check check (status in ('busy', 'maybe'));

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
    elsif p_status in ('busy', 'maybe') then
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
