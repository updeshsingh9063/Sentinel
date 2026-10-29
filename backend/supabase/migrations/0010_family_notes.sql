-- What the family notices.
--
-- The problem statement lists family input among the everyday signals the
-- system should combine, `signal_source` has carried a 'family_report' value
-- since 0001, and the landing page has been claiming it. Nothing implemented
-- it. Claiming a capability you do not have is worse than not having it.
--
-- WHY THIS IS ONE-WAY. A family member writes, a coordinator reads. There is
-- no reply, no thread, and no second family member reading the first one's
-- note. The point is to get "she sounded confused on Sunday" in front of the
-- person who can act on it, not to build a message board around a senior.
--
-- NO SAFETY GATE ON THIS TEXT, DELIBERATELY. Everywhere else in this system a
-- generated sentence is checked for condition names before it is stored. This
-- is not generated — it is a human telling a care professional what they saw,
-- in their own words, and a daughter is entitled to write "I think she is
-- getting confused" without a machine refusing her. The gate exists to stop
-- the SYSTEM making claims, not to police the family. What protects the
-- senior here is the direction of travel: this text reaches one coordinator
-- and is never shown to another family member, never fed back to a model, and
-- never used to score anything automatically.

create table if not exists family_notes (
  id          bigserial primary key,
  senior_id   uuid not null references seniors(id)   on delete cascade,
  author_id   uuid not null references app_users(id) on delete cascade,
  observed_on date not null default current_date,
  note_text   text not null check (length(trim(note_text)) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists family_notes_senior_idx
  on family_notes (senior_id, observed_on desc);

alter table family_notes enable row level security;

-- A family member may write about the senior they are linked to, and only as
-- themselves: author_id is checked against the caller rather than trusted
-- from the request, so a note cannot be attributed to someone else.
create policy family_notes_insert on family_notes
  for insert with check (
    is_family_of(senior_id) and author_id = auth.uid()
  );

-- Readable by the family member who wrote it and by the coordinator
-- responsible for that senior. Operations is absent, as everywhere else:
-- this is an individual record and that role has no business with one.
create policy family_notes_read on family_notes
  for select using (
    (is_family_of(senior_id) and author_id = auth.uid())
    or is_coordinator_of(senior_id)
    or is_admin()
  );

-- No update and no delete policy. A note already read by a coordinator and
-- acted on should not be able to disappear from the record afterwards.

revoke all on family_notes from anon;
