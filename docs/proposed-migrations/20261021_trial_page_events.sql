-- PROPOSED, NOT APPLIED. Database change: needs Tom's approval before it goes to production.
-- Target: the IMAOS Supabase project (the one api/lib/supabase.js connects to; migrations live in imaos-next).
--
-- Trial page drop-off events from trial-v2.html, posted by /api/trial-event.
-- One row per step a parent reaches, at most once per page view (visit_id).
-- No personal data: event names, field names and ad tags only. Never names, phone numbers, emails or typed values.
--
-- Why a new table: pixel_events has a similar shape, but it has no row security and the public
-- browser key holds every grant on it, so anyone could read, forge or delete the counts. It is also
-- part of the retired website builder (docs/website-builder-retirement.md in imaos-next).
--
-- Only the server writes here (service role). Row security is on with no policies, and the public
-- and signed-in keys get no grants, so the browser can neither read nor write it.
-- Additive only. Undo: drop table public.trial_page_events;

create table if not exists public.trial_page_events (
  id bigint generated always as identity primary key,
  created_at timestamp with time zone not null default now(),
  visit_id text,
  event_name text not null check (event_name in (
    'TrialPageLoaded','TrialOfferSeen','TrialFormSeen','TrialFormStarted',
    'TrialFieldParentFirstName','TrialFieldParentLastName','TrialFieldPhone','TrialFieldEmail',
    'TrialFieldChildFirstName','TrialFieldChildLastName','TrialFieldChildAge',
    'TrialSubmitTapped','TrialFormError','TrialCheckoutFailed','TrialLeftForStripe',
    'TrialClassPicked','TrialTimesUnavailable')),
  field_name text check (field_name in (
    'parent_first_name','parent_last_name','phone','email','child_first_name','child_last_name','child_age')),
  error_kind text check (error_kind in ('missing_or_invalid','checkout_failed')),
  error_fields text[],
  ms_since_load integer,
  page text,
  utm_source text,
  utm_campaign text,
  utm_content text,
  is_test boolean not null default false,
  studio_slug text not null default 'ima'
);

create index if not exists trial_page_events_created_idx on public.trial_page_events (created_at desc);
create index if not exists trial_page_events_event_idx on public.trial_page_events (event_name, created_at desc);
create unique index if not exists trial_page_events_visit_event_uq on public.trial_page_events (visit_id, event_name);

alter table public.trial_page_events enable row level security;
revoke all on table public.trial_page_events from anon, authenticated;
grant all on table public.trial_page_events to service_role;

-- Funnel for the last 7 days, real visits only:
-- select event_name, count(distinct visit_id) as visits
-- from public.trial_page_events
-- where not is_test and created_at > now() - interval '7 days'
-- group by event_name order by visits desc;
