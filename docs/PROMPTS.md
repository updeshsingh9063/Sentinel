# Asset prompts

Everything the landing page can use, with where it goes and what shape it
needs. Generate, drop the file at the path given, and it appears — no code
change.

Current state (2026-10-29): `hero.jpg` and `closing.jpg` are filled with
generated photography of Indian and South Asian subjects — see
`docs/PHOTOGRAPHY.md` for what is in each and how it was processed.
`impact.jpg` is deliberately empty; that band carries statistics and a
photograph behind them cannot win. `closing.mp4` has been retired because its
footage was the Western scene the stills no longer use.

| # | File | Shape | Where it appears |
|---|---|---|---|
| 1 | `frontend/public/img/hero.jpg` | 21:9, ≥2400px wide | Hero background, full bleed |
| 2 | `frontend/public/img/impact.jpg` | 3:2, ≥1800px wide | Impact band, right half — **intentionally empty**, read `PHOTOGRAPHY.md` before filling it |
| 3 | `frontend/public/img/closing.jpg` | 3:2, ≥1600px wide | Closing band, right half — **in place** |
| 4 | `frontend/public/video/closing.mp4` | 16:9, 8–14s silent loop | Closing band, right half — wired, currently absent. Drop one in and it takes over, with `closing.jpg` as its poster. Match the still, or both will be seen in the same second. |
| 5 | `frontend/public/video/dashboard.mp4` | 16:9, silent loop | **Dashboard section — in place.** HTML mock renders beneath as the placeholder |
| 6 | `frontend/public/img/signin.jpg` | ~1:1 upright, ≥1300px wide | Sign-in page, left half — **in place** |
| 7 | `frontend/public/img/og.jpg` | 1200×630 | Link preview card (optional) |
| 8 | `frontend/public/video/hero-loop.mp4` | 21:9, 8–12s silent loop | Optional moving hero |
| 9 | `frontend/public/video/demo.mp4` | 16:9, 60–90s | The "Watch Video" button |

Drop `closing.mp4` into `frontend/public/video/` and the closing band switches
from the photograph to the clip on the next request. No code change. If the
file is absent, or the browser refuses to autoplay, `closing.jpg` stays up.

That fallback is also a trap: the still is the clip's poster frame, so a clip
of a DIFFERENT scene shows the photograph and then cuts to something unrelated.
The previous `closing.mp4` was retired for exactly that reason.

## Casting

Every prompt below says **a fair-skinned older woman / man**, per your call.
Swap that phrase for "an Indian older woman / man" in one edit if you change
your mind — nothing else in the prompt needs to move.

Worth knowing before you lock it: *accessibility for low-tech, Hindi-speaking
seniors* is 15% of the judging weight, and the brief's audience is Samarth's
40,000 members across 350+ Indian cities. International-looking models read as
generic healthcare stock to that panel. Your product, your call — just make it
deliberately rather than by default.

---

## 1 · Hero — `hero.jpg`

Needs a quiet left third: the headline sits there over a dark gradient. The
subject must be in the **right** half of the frame.

> Editorial photograph of a fair-skinned woman in her seventies sitting in a
> comfortable armchair beside a tall window in a warm, well-kept living room,
> turned three-quarters toward the light and looking out of frame. Soft morning
> daylight falls across her face from the right. Behind her: a framed picture, a
> potted plant slightly out of focus, warm wood and muted olive tones. She is
> calm and dignified, not smiling at the camera. Shot on 50mm, shallow depth of
> field, natural skin texture with visible lines, warm colour grade, gentle
> contrast. Composed with the subject in the right half of the frame and the
> left third quiet and softly shadowed. Wide 21:9 crop.
>
> Avoid: looking at camera, broad smile, clinical or hospital setting, medical
> equipment, scrubs, wheelchair, stethoscope, pill bottles, studio lighting,
> heavy retouching, text, watermark, logos.

## 2 · Impact — `impact.jpg`

Sits under a deep-green gradient that covers the left ~50%, so keep the subject
right of centre and the left side simple.

> Editorial photograph from behind of a fair-skinned older couple sitting close
> together on a bench outdoors at golden hour, looking out over calm water. Low
> warm sun, long shadows, soft haze on the horizon. Their shoulders are
> relaxed and almost touching. Shot on 85mm, natural light, warm amber grade,
> fine grain. Subject right of centre, open sky and water filling the left.
>
> Avoid: faces toward camera, posed portraits, clinical setting, text,
> watermark, heavy HDR, oversaturated sunset.

## 3 · Closing — `closing.jpg`

Blends into cream, so it wants soft, high-key light and no hard edges.

> Close-up editorial photograph of a younger hand resting over an older
> fair-skinned hand, both at rest on a knee or a chair arm. Soft diffused
> daylight from a window, high-key and gentle, shallow focus with the
> background falling away into pale neutral tones. Calm and unsentimental, no
> faces in frame. Shot on 85mm macro, natural skin texture, visible veins and
> age on the older hand.
>
> Avoid: clasped praying hands, religious imagery, medical gloves, hospital
> bed, jewellery that draws the eye, text, watermark.

## 4 · Closing video — `closing.mp4`

Plays silently on the right half of the closing band, beside "Because every
senior still has a story to live." It sits next to a call to action, so it must
be **almost still** — a clip with real movement in it pulls the eye off the
buttons and makes the section feel like an advert.

**Specs.** 16:9, 1920×1080, 24 or 30fps, H.264 in an .mp4, **no audio track**,
8–14 seconds, cut to loop seamlessly (first and last frame should match), under
6 MB. Shoot or generate it so the subject sits **right of centre**: the left
quarter of the clip is faded into the cream background by the section gradient,
and a crop of roughly 3:2 is what actually shows.

> A near-static close-up of a younger hand resting over an older fair-skinned
> hand, both at rest on the arm of a chair. Soft diffused daylight from a
> window to the right, high-key and gentle, shallow focus with the background
> falling away into pale neutral tones. The only movement across the whole clip
> is one slow, gentle squeeze of the younger hand and the faintest shift of
> light. The camera is locked off and does not move or zoom. No faces in frame.
> Warm neutral grade, soft contrast, 85mm look. Hands positioned right of
> centre with the left of the frame soft and empty.
>
> Avoid: camera movement, zoom, push-in, cuts, people entering or leaving
> frame, faces, clasped praying hands, religious imagery, medical gloves,
> hospital bed, wristwatches or rings that catch the eye, on-screen text,
> watermark, logos, captions, music cues, fast motion, time-lapse.

If your generator keeps adding camera drift, ask for "locked-off tripod shot,
static camera, no camera movement" and generate at the shortest duration it
allows, then loop it in an editor.

**One check before you accept it:** scrub to the first and last frame. If they
do not match, the loop will visibly jump every few seconds directly beside the
Get Started button, which is the one place on the page that must feel calm.

## 5 · Link preview — `og.jpg` (optional)

1200×630. Not a photograph: a flat card so the link reads cleanly in Slack and
WhatsApp.

> Flat graphic card, 1200×630, deep forest-green background (#15382F). Centred
> cream serif wordmark reading "Samarth Sentinel", with a smaller line beneath
> in a neutral sans reading "Early warning for seniors living at home". A small
> two-leaf mark above the wordmark. Generous margins, no photograph, no
> gradient, no other text.

---

## 6 · Hero loop — `hero-loop.mp4` (optional)

Only worth doing if it is nearly still. A busy loop behind a headline is worse
than a photograph. Silent, 8–12 seconds, seamless, 21:9, H.264, under 4 MB.

> A near-static shot of a fair-skinned older woman sitting by a sunlit window in
> a warm living room, seen three-quarters from the side. The only movement is
> the slow drift of a sheer curtain and dust in the light, and one slow blink.
> The camera does not move. Warm morning light, shallow depth of field, calm
> and quiet. Subject in the right half of frame.

If you add it, tell me and I will wire it in behind the hero with the
photograph as the poster frame, muted and `playsinline`, paused under
`prefers-reduced-motion`.

## 7 · Product demo — `demo.mp4`

This is a screen recording, not a generated clip. 60–90 seconds, 16:9, captured
at 1920×1080. The "Watch Video" button in the hero opens it.

Shot list, in order:

1. **The list, 8s.** The coordinator worklist on screen. Hold still long enough
   to read the top row. Say: three hundred families, one coordinator, ten calls
   a day. The question is never "is someone at risk" — it is "who do I ring
   first".
2. **Why this row, 15s.** Open one senior. Show the reasons that moved the
   score: readings above their own baseline, two doses unlogged, a phrase from
   a call note. Say that the baseline is personal — the same reading is
   unremarkable for someone else.
3. **The Hinglish note, 10s.** Show the original phrase quoted, untranslated,
   with the cue it raised. Say the system shows the phrase and the human
   interprets it.
4. **The action, 10s.** Show the next step: ring her this morning, confirm the
   evening dose, offer a nurse visit. Say every path ends at a person.
5. **The verdict, 8s.** Mark the alert true concern or false alarm. Say this is
   the only thing that makes precision measurable.
6. **The senior's side, 10s.** The phone check-in: it rings, three keypad
   options, no app and no smartphone.
7. **The limits, 10s.** Say plainly: synthetic cohort of 200 seniors over 90
   days, no real patient data, no clinical claim, and it never names a
   condition to anyone.

Record at 1920×1080, no music, no stock voiceover. Judges mark honesty about
limitations, so shot 7 is not optional.

---

## After you add any generated asset

Record it in `datasets/MANIFEST.json`: the tool and model, the date, the prompt,
and a line stating the people shown are **synthetic and not real Samarth
members**. Say the same in the pitch. Citation is separately scored, and an
unlabelled generated person in a healthcare demo is the kind of thing a judge
should catch.
