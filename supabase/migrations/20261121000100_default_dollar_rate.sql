-- =============================================================================
-- Vio Accounting — the company's dollar rate for new entries
-- One rate per company, set from the top bar. A new entry typed in dollars starts
-- with it and can still use a different rate. Saved entries keep the rate they
-- were saved with (journal_entries.exchange_rate), so changing this one never
-- changes them. Anyone who may create entries may set it; the change is recorded
-- in the audit log by the company_settings audit trigger.
-- =============================================================================

alter table public.company_settings
  add column if not exists default_exchange_rate numeric(18, 8)
    check (default_exchange_rate is null or (default_exchange_rate > 0 and default_exchange_rate < 1e10));

create or replace function public.set_default_exchange_rate(p_company_id uuid, p_rate numeric)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public._require_permission(p_company_id, 'entries.create');
  if p_rate is not null and (p_rate <= 0 or p_rate >= 1e10 or round(p_rate, 8) <> p_rate) then
    perform public._raise('EXCHANGE_RATE_INVALID');
  end if;
  update public.company_settings s
     set default_exchange_rate = p_rate
   where s.company_id = p_company_id;
end;
$$;

revoke execute on function public.set_default_exchange_rate(uuid, numeric) from public, anon;
grant execute on function public.set_default_exchange_rate(uuid, numeric) to authenticated;
