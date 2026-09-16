create table if not exists public.quality96_submissions (
  id text primary key,
  "createdAt" timestamptz not null,
  "score96" integer not null check ("score96" between 0 and 96),
  trait text not null,
  "traitTitle" text,
  "durationSeconds" integer,
  "timedOut" boolean default false,
  answers jsonb not null default '[]'::jsonb
);

alter table public.quality96_submissions enable row level security;

create policy "allow anonymous inserts for event kiosk"
on public.quality96_submissions
for insert
to anon
with check (true);


create policy "allow anonymous reads for event kiosk"
on public.quality96_submissions
for select
to anon
using (true);
