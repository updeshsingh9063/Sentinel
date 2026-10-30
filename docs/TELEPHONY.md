# Making the phone actually ring

Everything in this repo is built and tested except the dialling. The
conversation, the Hindi voice, the daily planner, the record it writes and the
escalation when nobody answers all work and are covered by
`npm run verify:telephony` — which drives a complete call through the webhook
exactly as a provider would, form-encoded, turn by turn.

What is missing is a telephony account. Here is everything needed, in order.

---

## 1. Twilio, and the one rule that catches everyone

Calls **into** India must come **from a non-Indian number**. Twilio stopped
supporting local outbound within India in August 2024, so an Indian Twilio
number cannot ring an Indian mobile. Buy a **US or UK number** instead; it
dials +91 fine and arrives as an international call.

Two more things to settle before a demo rather than during one:

- **Trial accounts only dial verified numbers.** Add the destination under
  *Phone Numbers → Verified Caller IDs* first, or the call is rejected.
- **India's DND registry can refuse commercial calls outright.** Test the
  actual number you plan to demo with, on day one. If it is DND-registered you
  will want a different handset.

Twilio prepends a short "trial account" message to every call until the
account is upgraded.

---

## 2. Environment variables

Set these in **Vercel → Settings → Environment Variables** (Production), and
in `frontend/.env.local` for local testing.

| Variable | What it is |
|---|---|
| `TWILIO_ACCOUNT_SID` | From the Twilio console dashboard |
| `TWILIO_TOKEN` | Auth token, same page |
| `TWILIO_FROM` | Your US/UK Twilio number, E.164: `+1...` |
| `TELEPHONY_SECRET` | Already in `.env.local`. Copy it to Vercel — the webhook URL carries it |
| `PUBLIC_BASE_URL` | `https://samarth-sentinel.vercel.app` — **not** localhost in production |
| `CRON_SECRET` | Any long random string. Guards the daily round |
| `RUNNER_EMAIL` / `RUNNER_PASSWORD` | A coordinator account the scheduler signs in as, so it can plan the day. Use a dedicated one, not a person's |

`TELEPHONY_SECRET` is the only credential the webhook holds, and everything it
can do is in four database functions that cannot read a senior, a vital or a
score. There is no service-role key in this deployment and there must not be.

---

## 3. Point Twilio at the webhook

Nothing to configure in the Twilio console: the call is placed with its
webhook URL attached, so the number itself needs no "A call comes in" setting
for **outbound** calls.

If you also want the number to accept **inbound** calls — a senior ringing the
line themselves, which is the cheapest channel there is — set the number's
*A call comes in* webhook to:

```
https://samarth-sentinel.vercel.app/api/call/voice?key=<TELEPHONY_SECRET>
```

The same route handles both directions. It resolves who is calling from the
number and opens the conversation.

---

## 4. The daily round

`frontend/vercel.json` already schedules it:

```json
{ "crons": [{ "path": "/api/call/run", "schedule": "30 3 * * *" }] }
```

03:30 UTC is 09:00 IST. Vercel Cron sends a `GET` with
`Authorization: Bearer $CRON_SECRET`, which the route accepts.

Each run:

1. `plan_calls()` — reads every senior against **their own** recent fortnight
   and decides who needs ringing and why.
2. Dials up to 20 of them, one call per person however many reasons they have.
3. Each answered call writes a check-in, a transcript, any cues, and any
   errand onto the coordinator's queue.
4. Each unanswered call is recorded as an attempt. Two of them become
   "somebody should go round" on the help queue.

Trigger it by hand to watch it work:

```bash
curl -X POST "https://samarth-sentinel.vercel.app/api/call/run?key=$CRON_SECRET"
```

With no Twilio credentials it plans the day, dials nothing, and says so.

---

## 5. Check it before you rely on it

```bash
curl https://samarth-sentinel.vercel.app/api/call/run     # lists what is missing
curl https://samarth-sentinel.vercel.app/api/call/place   # same, for one-off calls
npm run verify:telephony                                  # 24 checks, no provider needed
```

`/api/call/run` and `/api/call/place` both report exactly which variables are
unset rather than failing vaguely.

---

## What this still is not

Twilio's own speech recognition handles the Hindi on a real call, and it is
noticeably worse than the Whisper path the browser simulator uses. The better
version streams the audio to Whisper over a websocket (Twilio Media Streams).
That is a day's work and another moving part to fail live, so it is not here.
The transcript on each record says which path produced it.

Nothing in this system calls an ambulance, notifies emergency services, or
dispatches anyone. An emergency puts a named person at the top of a human
being's list and records the time.
