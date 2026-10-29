-- The next step, in Hindi.
--
-- The interface is bilingual and the senior-facing check-in is Hindi-first,
-- but the explain layer wrote English only, so a coordinator reading the Hindi
-- worklist still got an English instruction. For a product whose accessibility
-- story is Hindi-speaking users, that is the wrong half to leave untranslated.
--
-- It is a stored column rather than a translation at render time because this
-- sentence has to pass the never-diagnose gate, and the gate lives in the
-- explain layer beside the generator. A string translated in the browser would
-- be the one sentence on the page nobody checked.
--
-- Nullable: rows written before this migration have no Hindi text, and the
-- interface falls back to English rather than showing a blank instruction.

alter table alerts add column if not exists next_step_hi text;

comment on column alerts.next_step_hi is
  'Hindi next step, generated and safety-checked alongside next_step. NULL on '
  'rows written before migration 0008; callers fall back to next_step.';
