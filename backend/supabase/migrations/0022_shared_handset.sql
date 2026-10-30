-- Two seniors may share one telephone.
--
-- Migration 0012 made the number unique, because a missed call is matched by
-- the number that dialled and the match had to be unambiguous. That reasoning
-- was sound and the constraint was still wrong, in two directions.
--
-- IT IS WRONG ABOUT THE WORLD. A married couple in one house has one
-- telephone. A widow living with her son uses his. On a basic handset, which
-- is the whole point of this channel, the telephone belongs to the household
-- rather than the person. A system that cannot enrol the second person in a
-- house is not usable for the population it was built for.
--
-- IT IS WRONG ABOUT THE DEMO. A trial telephony account can dial exactly one
-- verified handset, so under this constraint the call button works on one row
-- and appears broken on every other.
--
-- WHAT MADE IT SAFE TO DROP. Migration 0021 moved OUTBOUND calls onto the
-- senior id the dialler passes, so a shared number no longer decides who an
-- outbound call is about — which was the real hazard, and a silent one: the
-- call sounds right and the record is wrong.
--
-- WHAT IS STILL AMBIGUOUS, HONESTLY. An INBOUND call and a missed call have
-- only the number. With two seniors behind one handset, those are resolved to
-- the older record, deterministically. That is a guess, and it is documented
-- as one here rather than hidden behind a constraint that pretends the case
-- cannot arise. The guess is also the least bad option available: refusing
-- the call outright would drop a real contact from a real person.
--
-- The UI still refuses to put one number on two seniors, because a
-- coordinator typing a duplicate has almost certainly made a mistake. A
-- household sharing a handset is a deliberate act, not a typo, and goes
-- through scripts/set-demo-numbers.mjs.

drop index if exists seniors_phone_last10_idx;

-- Still indexed, just not unique: every lookup in the telephony path filters
-- on these ten digits, and without an index that is a sequential scan of the
-- cohort on every turn of every call.
create index if not exists seniors_phone_last10_idx
  on seniors ((right(regexp_replace(phone, '\D', '', 'g'), 10)))
  where phone is not null;

comment on index seniors_phone_last10_idx is
  'Last ten digits of the telephone, for resolving a caller. NOT unique: a '
  'household may share one handset. Outbound calls carry the senior id '
  'instead (migration 0021); inbound resolves to the oldest record.';
