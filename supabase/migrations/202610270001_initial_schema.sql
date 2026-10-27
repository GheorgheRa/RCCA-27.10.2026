create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  display_name text,
  department text,
  role text not null default 'user' check (role in ('admin', 'user')),
  page_permissions text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_user();

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.role is distinct from old.role
    or new.page_permissions is distinct from old.page_permissions
    or new.department is distinct from old.department
  ) and session_user not in ('postgres', 'supabase_admin')
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.is_admin() then
    raise exception 'Only administrators can change user roles, page permissions, or department';
  end if;
  return new;
end;
$$;

create trigger protect_profile_role_before_update
  before update on public.profiles
  for each row execute procedure public.protect_profile_role();

create table public.production_issues (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  issue_number text,
  title text not null,
  issue_type text not null,
  defect_description text,
  severity text default 'medium',
  status text default 'containment',
  feedback_pending boolean not null default false,
  reported_date text,
  machine text,
  part_number text,
  operation text,
  batch_number text,
  total_parts numeric,
  parts_to_analyze numeric,
  parts_nok numeric,
  parts_ok numeric,
  quantity_affected numeric,
  containment_necessary text,
  wip_qty numeric,
  stock_qty numeric,
  transit_qty numeric,
  assigned_to text,
  description text,
  reported_by text,
  root_cause_category text,
  why_1 text,
  why_2 text,
  why_3 text,
  why_4 text,
  why_5 text,
  root_cause text,
  corrective_action text,
  corrective_action_owner text,
  corrective_action_due_date text,
  corrective_action_completed_date text,
  corrective_actions_json text,
  preventive_action text,
  verification_notes text,
  verified_by text,
  verified_date text,
  ncr_number text,
  closed_date text,
  image_urls jsonb not null default '[]'::jsonb,
  downtime_start text,
  downtime_end text,
  notion_page_id text
);
create index production_issues_created_date_idx on public.production_issues (created_date desc);
create index production_issues_status_idx on public.production_issues (status);
create index production_issues_issue_number_idx on public.production_issues (issue_number);

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  batch_number text not null,
  part_number text not null,
  part_description text,
  machine text,
  operation_number text,
  production_date text,
  operation_name text,
  total_parts numeric,
  parts_ok numeric,
  parts_reprocessed numeric,
  parts_nok numeric,
  notes text,
  rcca_issue_id uuid,
  rcca_issue_number text,
  ncr_number text,
  saved_by text,
  _operation_rows text
);
create index production_batches_production_date_idx on public.production_batches (production_date desc);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  title text not null,
  document_type text not null,
  description text,
  file_url text,
  file_name text,
  version text,
  status text default 'draft',
  linked_issue_id uuid,
  linked_issue_number text,
  linked_batch_id uuid,
  linked_batch_number text,
  department text,
  tags jsonb not null default '[]'::jsonb
);

create table public.inspection_standards (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  client_folder text not null,
  title text not null,
  file_url text,
  file_name text,
  technical_summary text,
  uploaded_by text
);

create table public.issue_archives (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  archive_name text not null,
  start_date text not null,
  end_date text not null,
  record_count integer,
  data text,
  archived_by text
);

create table public.picklist_options (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  category text not null,
  label text not null,
  value text not null,
  client text,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
create index picklist_options_category_order_idx on public.picklist_options (category, sort_order);

create table public.standup_meetings (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  meeting_date text not null,
  started_at text,
  ended_at text,
  duration_seconds integer,
  resolved_count integer,
  new_count integer,
  open_count integer,
  escalated_count integer
);

create table public.standup_points (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  category text not null,
  description text not null,
  action text,
  client_complaint text,
  owner_role text,
  owner_name text,
  owner_email text,
  meeting_date text,
  due_date text,
  status text not null default 'Open',
  is_critical boolean not null default false,
  created_at text,
  resolved_at text,
  is_archived boolean not null default false
);
create index standup_points_meeting_date_idx on public.standup_points (meeting_date);

create table public.visual_inspection_entries (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  issue_number text not null,
  issue_id uuid,
  part_number text,
  part_alias text,
  batch_number text,
  client text,
  image_urls jsonb not null default '[]'::jsonb,
  ai_model_used text,
  ai_confidence_score numeric,
  ai_defect_detected boolean,
  ai_explanation text,
  ai_references text,
  ai_improvement_suggestions text,
  human_validated boolean not null default false,
  human_agrees_with_ai boolean,
  human_corrected_label text,
  human_feedback text,
  validated_by text,
  validated_at text,
  status text not null default 'pending'
);
create index visual_inspection_entries_issue_number_idx on public.visual_inspection_entries (issue_number);

create table public.ai_prompt_configs (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  prompt_text text not null,
  updated_by text
);

create table public.ai_learned_lessons (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  summary_text text not null,
  corrections_count integer,
  last_correction_id uuid,
  generated_at text,
  generated_by text
);

create table public.ai_job_runs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_run_at timestamptz not null default now()
);
alter table public.ai_job_runs enable row level security;

create or replace function public.set_updated_date()
returns trigger
language plpgsql
as $$
begin
  new.updated_date = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'production_issues', 'production_batches', 'documents',
    'inspection_standards', 'issue_archives', 'picklist_options',
    'standup_meetings', 'standup_points', 'visual_inspection_entries',
    'ai_prompt_configs', 'ai_learned_lessons'
  ] loop
    execute format(
      'create trigger set_updated_date before update on public.%I for each row execute procedure public.set_updated_date()',
      table_name
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.production_issues enable row level security;
alter table public.production_batches enable row level security;
alter table public.documents enable row level security;
alter table public.inspection_standards enable row level security;
alter table public.issue_archives enable row level security;
alter table public.picklist_options enable row level security;
alter table public.standup_meetings enable row level security;
alter table public.standup_points enable row level security;
alter table public.visual_inspection_entries enable row level security;
alter table public.ai_prompt_configs enable row level security;
alter table public.ai_learned_lessons enable row level security;

create policy "Profiles are visible to their owner and admins" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "Profiles are editable by their owner and admins" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy "Authenticated users can read issues" on public.production_issues
  for select to authenticated using (true);
create policy "Authenticated users can create issues" on public.production_issues
  for insert to authenticated with check (true);
create policy "Issue authors and admins can update issues" on public.production_issues
  for update to authenticated using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());
create policy "Admins can delete issues" on public.production_issues
  for delete to authenticated using (public.is_admin());

create policy "Authenticated users can read batches" on public.production_batches
  for select to authenticated using (true);
create policy "Authenticated users can create batches" on public.production_batches
  for insert to authenticated with check (true);
create policy "Authenticated users can update batches" on public.production_batches
  for update to authenticated using (true) with check (true);
create policy "Admins can delete batches" on public.production_batches
  for delete to authenticated using (public.is_admin());

create policy "Document owners, departments, and admins can read documents" on public.documents
  for select to authenticated using (
    created_by = auth.uid()
    or public.is_admin()
    or (
      department is not null
      and department = (select profile.department from public.profiles as profile where profile.id = auth.uid())
    )
  );
create policy "Authenticated users can create documents" on public.documents
  for insert to authenticated with check (true);
create policy "Document authors and admins can update documents" on public.documents
  for update to authenticated using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());
create policy "Admins can delete documents" on public.documents
  for delete to authenticated using (public.is_admin());

create policy "Authenticated users can read standards" on public.inspection_standards
  for select to authenticated using (true);
create policy "Admins can manage standards" on public.inspection_standards
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Authenticated users can read archives" on public.issue_archives
  for select to authenticated using (true);
create policy "Admins can manage archives" on public.issue_archives
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Authenticated users can read picklists" on public.picklist_options
  for select to authenticated using (true);
create policy "Admins can manage picklists" on public.picklist_options
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Authenticated users can read standup meetings" on public.standup_meetings
  for select to authenticated using (true);
create policy "Authenticated users can manage standup meetings" on public.standup_meetings
  for all to authenticated using (true) with check (true);

create policy "Authenticated users can read standup points" on public.standup_points
  for select to authenticated using (true);
create policy "Authenticated users can manage standup points" on public.standup_points
  for all to authenticated using (true) with check (true);

create policy "Authenticated users can read inspection entries" on public.visual_inspection_entries
  for select to authenticated using (true);
create policy "Authenticated users can create inspection entries" on public.visual_inspection_entries
  for insert to authenticated with check (true);
create policy "Authenticated users can update inspection entries" on public.visual_inspection_entries
  for update to authenticated using (true) with check (true);
create policy "Admins can delete inspection entries" on public.visual_inspection_entries
  for delete to authenticated using (public.is_admin());

create policy "Authenticated users can read AI prompts" on public.ai_prompt_configs
  for select to authenticated using (true);
create policy "Admins can manage AI prompts" on public.ai_prompt_configs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Authenticated users can read learned lessons" on public.ai_learned_lessons
  for select to authenticated using (true);
create policy "Admins can manage learned lessons" on public.ai_learned_lessons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.picklist_options (category, label, value, sort_order) values
  ('IssueType_Picklist', 'Process efficiency', 'Process efficiency', 0),
  ('IssueType_Picklist', 'Material (Supplier)', 'Material (Supplier)', 1),
  ('IssueType_Picklist', 'FPI', 'FPI', 2),
  ('IssueType_Picklist', 'Handling', 'Handling', 3),
  ('IssueType_Picklist', 'TC human error', 'TC human error', 4),
  ('IssueType_Picklist', 'Setup', 'Setup', 5),
  ('IssueType_Picklist', 'Tool & Fixture', 'Tool & Fixture', 6),
  ('IssueType_Picklist', 'Special Process', 'Special Process', 7),
  ('IssueType_Picklist', 'Deburring', 'Deburring', 8),
  ('IssueType_Picklist', 'Machine defective', 'Machine defective', 9),
  ('IssueType_Picklist', 'Breakdown', 'Breakdown', 10),
  ('IssueType_Picklist', 'Measurement', 'Measurement', 11),
  ('ProcessStep_Picklist', 'Moriseiki', 'Moriseiki', 0),
  ('ProcessStep_Picklist', 'Chiron', 'Chiron', 1),
  ('ProcessStep_Picklist', 'Hermle', 'Hermle', 2),
  ('ProcessStep_Picklist', 'Hembrug', 'Hembrug', 3),
  ('ProcessStep_Picklist', 'Benzinger', 'Benzinger', 4),
  ('ProcessStep_Picklist', 'Debavurare', 'Debavurare', 5),
  ('ProcessStep_Picklist', 'Marcare', 'Marcare', 6),
  ('ProcessStep_Picklist', 'Inspectie Intermediara', 'Inspectie Intermediara', 7),
  ('ProcessStep_Picklist', 'Procese Speciale', 'Procese Speciale', 8),
  ('ProcessStep_Picklist', 'FPI', 'FPI', 9),
  ('ProcessStep_Picklist', 'Brazare', 'Brazare', 10),
  ('ProcessStep_Picklist', 'Asamblare', 'Asamblare', 11),
  ('ProcessStep_Picklist', 'Inspectie Finala', 'Inspectie Finala', 12),
  ('department', 'Productie', 'Productie', 0),
  ('department', 'Procese Speciale', 'Procese Speciale', 1),
  ('department', 'FPI', 'FPI', 2),
  ('department', 'CADCAM', 'CADCAM', 3),
  ('department', 'Quality', 'Quality', 4),
  ('department', 'LE', 'LE', 5),
  ('department', 'Logistica', 'Logistica', 6),
  ('department', 'Mentenanta', 'Mentenanta', 7),
  ('department', 'Management', 'Management', 8),
  ('DefectType_Picklist', 'Dimensional', 'Dimensional', 0),
  ('DefectType_Picklist', 'Functional', 'Functional', 1),
  ('DefectType_Picklist', 'Vizual', 'Vizual', 2),
  ('DefectType_Picklist', 'Acoperire', 'Acoperire', 3),
  ('DefectType_Picklist', 'Documentatie', 'Documentatie', 4),
  ('DefectType_Picklist', 'Trasabilitate', 'Trasabilitate', 5),
  ('DefectType_Picklist', 'Altele', 'Altele', 6);

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('app-files', 'app-files', true, 52428800),
  ('private-uploads', 'private-uploads', false, 52428800)
on conflict (id) do nothing;

create policy "Public app files are readable" on storage.objects
  for select to public using (bucket_id = 'app-files');
create policy "Users upload files into their own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id in ('app-files', 'private-uploads')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "Users can update their own files" on storage.objects
  for update to authenticated using (
    bucket_id in ('app-files', 'private-uploads')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  ) with check (
    bucket_id in ('app-files', 'private-uploads')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
create policy "Users can delete their own files" on storage.objects
  for delete to authenticated using (
    bucket_id in ('app-files', 'private-uploads')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
create policy "Users can read private files they own" on storage.objects
  for select to authenticated using (
    bucket_id = 'private-uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

alter publication supabase_realtime add table public.production_issues;
