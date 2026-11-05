-- =============================================================================
-- Vio Accounting — storage bucket, storage policies and privilege hardening
-- =============================================================================

-- Private bucket for supporting documents. Object paths are
--   <company_id>/<entity_type>/<entity_id>/<uuid>-<file name>
--   <company_id>/branding/<uuid>-logo.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 10485760,
  array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy attachments_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_company_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy attachments_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and case
          when (storage.foldername(name))[2] = 'branding'
            then public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'settings.manage')
          else public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'entries.create')
        end
  );

-- Only files that are no longer referenced by an attachment record (i.e. the
-- record was removed from a draft through delete_attachment) can be deleted.
create policy attachments_delete_unreferenced on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[2] <> 'branding'
    and public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'entries.edit_draft')
    and not public.attachment_path_in_use(name)
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- Tables are readable through RLS; financial tables are written exclusively by
-- SECURITY DEFINER functions. Internal helpers (prefixed with "_") are not
-- callable through the API.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.accounts to authenticated;
grant update on public.companies, public.company_settings to authenticated;
grant update (full_name, preferred_language, default_company_id) on public.profiles to authenticated;

revoke all on all sequences in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like '\_%'
       and p.proname <> '_raise'
  loop
    execute format('revoke execute on function %s from authenticated', r.signature);
  end loop;
end;
$$;

-- Companies and settings may only change descriptive columns through the API.
revoke update on public.companies from authenticated;
grant update (name_en, name_ar, legal_name, tax_number, registration_number, address_en, address_ar,
              phone, email, website, logo_path)
  on public.companies to authenticated;

revoke update on public.company_settings from authenticated;
grant update (require_approval, retained_earnings_account_id, default_language, report_show_signatures)
  on public.company_settings to authenticated;

revoke insert, update, delete on public.accounts from authenticated;
grant insert (company_id, code, name_en, name_ar, parent_id, account_type, category_code, normal_balance,
              is_posting, is_active, description, created_by)
  on public.accounts to authenticated;
grant update (code, name_en, name_ar, parent_id, account_type, category_code, normal_balance,
              is_posting, is_active, description)
  on public.accounts to authenticated;
grant delete on public.accounts to authenticated;
