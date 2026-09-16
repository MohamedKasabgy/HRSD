-- تحدي 96 ثانية: شغّل هذا الملف كاملاً في Supabase SQL Editor.
-- الوظيفة أدناه هي الطريق الوحيد الذي يستخدمه التطبيق للإضافة؛
-- تقفل المعاملة مؤقتاً، وتمنع تكرار session_id، ولا تسمح بتجاوز 96.

create extension if not exists pgcrypto;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  participant_number integer not null unique check (participant_number between 1 and 96),
  score integer not null check (score between 0 and 96),
  quality_type text not null,
  answers jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now(),
  session_id text not null unique
);

create index if not exists participants_completed_at_idx on public.participants (completed_at desc);
create index if not exists participants_quality_type_idx on public.participants (quality_type);

alter table public.participants enable row level security;

-- العرض العام يحتاج القراءة فقط. لا توجد سياسة UPDATE أو DELETE للعامة.
drop policy if exists "Public can read event participants" on public.participants;
create policy "Public can read event participants"
on public.participants for select to anon using (true);

-- سياسة INSERT موجودة للمتطلبات وللتشخيص؛ التطبيق يضيف فعلياً عبر RPC الآمنة أدناه.
drop policy if exists "Public can insert event participants" on public.participants;
create policy "Public can insert event participants"
on public.participants for insert to anon with check (
  participant_number between 1 and 96 and score between 0 and 96
);

create or replace function public.complete_participant(
  p_session_id text,
  p_score integer,
  p_quality_type text,
  p_answers jsonb
)
returns table (
  id uuid,
  participant_number integer,
  score integer,
  quality_type text,
  answers jsonb,
  completed_at timestamptz,
  session_id text,
  inserted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.participants%rowtype;
  next_number integer;
begin
  -- يحمي العدّ والإدراج من Race Condition بين عدة أجهزة.
  perform pg_advisory_xact_lock(960096);

  select * into existing from public.participants where participants.session_id = p_session_id;
  if found then
    return query select existing.id, existing.participant_number, existing.score,
      existing.quality_type, existing.answers, existing.completed_at, existing.session_id, false;
    return;
  end if;

  select count(*) + 1 into next_number from public.participants;
  if next_number > 96 then
    raise exception 'MAX_PARTICIPANTS_REACHED' using errcode = 'P0001';
  end if;

  insert into public.participants (participant_number, score, quality_type, answers, session_id)
  values (next_number, p_score, p_quality_type, p_answers, p_session_id)
  returning * into existing;

  return query select existing.id, existing.participant_number, existing.score,
    existing.quality_type, existing.answers, existing.completed_at, existing.session_id, true;
end;
$$;

revoke all on function public.complete_participant(text, integer, text, jsonb) from public;
grant execute on function public.complete_participant(text, integer, text, jsonb) to anon;

-- تصفير مركزي بسيط لزر لوحة المشرف. لا توجد حماية إضافية بطلب صاحب المشروع.
create or replace function public.reset_participants()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- شرط صريح مطلوب من حماية Supabase، ويطابق كل المشاركات الفعلية.
  delete from public.participants where id is not null;
end;
$$;

revoke all on function public.reset_participants() from public;
grant execute on function public.reset_participants() to anon;

-- فعّل بث INSERT وDELETE اللحظي للعرض الخارجي.
do $$ begin
  alter publication supabase_realtime add table public.participants;
exception when duplicate_object then null;
end $$;
