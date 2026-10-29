# Photography

Three slots, three prompts. Written for whoever generates or shoots them.

Drop the result at `frontend/public/img/<slot>.jpg` and the page picks it up on
the next request — no code change. Until then each slot renders a designed
stand-in that names what it wants, so the page is presentable either way.

## Current state — 2026-10-29

| Slot | File | Status |
|---|---|---|
| `hero` | `frontend/public/img/hero.jpg` | **Filled.** Generated: an older Indian man with tea, a care worker's hand on his shoulder, bright plant-filled room. |
| `closing` | `frontend/public/img/closing.jpg` | **Filled.** Generated: a care worker holding an older person's hand. |
| `impact` | — | **Deliberately empty.** See below. |
| `checkin` | `frontend/public/img/checkin.jpg` | **Filled.** An empty sitting room, no people, bare wall through the middle. It sits behind the check-in card, so a face there would compete with the largest type in the product. |
| `signin` | `frontend/public/img/signin.jpg` | **Filled.** Generated: an older man in a kurta with tea, a younger family member leaning in. Fills the left half of the sign-in split; no watermark on this source, so no trim. |

Both were supplied as PNGs and processed through `npm run img:prep` (see
"Processing" below). The raw sources are in this folder, not in `public/`:
nothing unprocessed should sit in a directory the server hands out.

Retired photographs — the lake couple, the Western hand-hold, the man in the
orange shirt on a bridge, and the closing video loop that matched them — are in
`docs/photography/rejected/`, out of `public/` as well.

### Why `impact` is empty on purpose

The impact band puts four columns of statistics across the right two thirds of
the band. Any photograph in that slot ends up UNDER them, and no crop changes
that — the previous one put a man's face directly behind a figure and its
citation. The band now carries a designed forest ground instead, and the stats
are legible.

The slot still works: drop a file at `frontend/public/img/impact.jpg` and it
appears. But its scrim floors at 0.82 now, so whatever goes there is
atmosphere at the outer edge rather than a picture competing with type. Judge a
candidate with the statistics on top of it, never on its own.

### Processing

`frontend/scripts/prep-image.mjs`, via `npm run img:prep --`:

```
npm run img:prep -- --in "docs/photography/hero-tea-caregiver.png"   --out public/img/hero.jpg --trim-bottom 92 --width 1800 --grade warm --quality 84
```

It does three things, each for a reason:

- **trims** the bottom strip, because generated stock carries a sparkle
  watermark in the bottom-right corner and that is the clearest "AI stock" tell
  on the page. Cropped rather than painted over — a patched corner is a smudge.
- **grades** toward the palette. Sources arrive with saturated blues and
  oranges that fight forest and cream.
- **resamples** up with lanczos, because a 1264px source is soft behind a
  full-bleed hero.

`--grade forest` collapses an image to one hue, for anything that has to sit
under type.

## Why the old photographs were removed

All six are in `frontend/public/img/_rejected/`. They were CC0 stock, and all
six showed white Western subjects. Two were worse than merely mismatched:
`coordinator.jpg` showed a clinician in scrubs in what reads as a clinical
room, and `hands.jpg` a walking stick with clinicians blurred behind it. This
product does not deliver care — it routes attention to a human — so a clinician
in frame contradicts the brief, and a white face contradicts a product for 150
million Indians aged 60+.

Openverse returns **zero** CC0 results for Indian seniors under every phrasing
tried, which is why these are generated rather than sourced.

## Rules that apply to all three

- **Documentary, not stock.** Ordinary rooms, available light, nobody posing or
  beaming at the camera. If it looks like a brochure it is wrong.
- **No clinical signal at all.** No stethoscope, scrubs, ward, drip, wheelchair,
  pill organiser or branded uniform.
- **No religious signal.** Samarth's members are mixed-faith, so no idols,
  crosses, tilak, prayer beads or temple imagery. A plain wall calendar is fine.
- **No poverty or pity framing**, and equally no affluent showroom interior.
  These are ordinary middle-class Indian homes.
- **Real skin.** Visible texture, lines, grey hair, slightly uneven lighting.
  Beauty retouching is the fastest way to make this look generated.
- **The subject sits off-centre**, with a quieter area of frame on one side.
  Type never crosses a face in this design system.

## The prompts

Each is written to work in Midjourney, Flux, Imagen or DALL·E. Append your
tool's own aspect flag (`--ar 21:9` and so on).

### 1 · `senior-home.jpg` — 21:9 wide, full-bleed band

> Documentary photograph of an Indian woman in her seventies sitting alone in
> the front room of her own middle-class home in the morning. She is on a
> wooden diwan with a faded cushion, wearing a simple cotton saree with a
> shawl over her shoulders. Mosaic terrazzo floor, a steel almirah against the
> wall, a ceiling fan, a barred window with soft daylight coming through a thin
> curtain, a wall calendar. She is looking out of the window, not at the
> camera, with a neutral, unhurried expression. Shot on 35mm film, available
> light only, natural skin texture, fine grain, muted warm colours, slightly
> desaturated. Wide shot from across the room, subject placed left of centre
> with empty room to the right.
>
> Avoid: smiling at camera, studio lighting, retouched skin, clinical or
> hospital setting, medical equipment, religious imagery, marigolds, poverty
> framing, luxury interior, text, watermark.

### 2 · `coordinator.jpg` — 3:4 portrait, small, beside the worklist

> Documentary photograph of an Indian woman in her thirties working as a care
> coordinator, at a plain desk in a small office, mid phone call with a headset
> or a handset held to her ear. An open ruled notebook with handwritten names
> in front of her, a pen, a glass of water, a laptop turned slightly away. She
> is listening and writing, concentrating, not looking at the camera. Daylight
> from a window to one side, ordinary fluorescent room light. Shot on 50mm,
> shallow depth of field, natural skin texture, muted colours. Vertical
> portrait crop.
>
> Avoid: scrubs, stethoscope, lab coat, hospital, call-centre rows of
> identical desks, headset model shot, smiling at camera, stock-photo polish,
> text, watermark.

### 3 · `senior-phone.jpg` — 16:10 landscape, beside the keypad

> Documentary photograph of an Indian man in his seventies at home, holding an
> old basic keypad feature phone to his ear with one hand. He wears a simple
> cotton kurta. He is seated near a window in an ordinary front room, soft
> daylight on the side of his face, a plastic chair and a painted wall behind
> him. His expression is attentive and calm, listening rather than talking,
> eyes away from the camera. Shot on 35mm film, available light, natural skin
> texture and visible lines on his hands, fine grain, muted warm colours.
> Subject right of centre with quiet wall to the left.
>
> Avoid: smartphone, touchscreen, modern handset, smiling at camera, studio
> lighting, retouched skin, clinical setting, medical equipment, religious
> imagery, text, watermark.

## What to check before accepting a generated image

Generated people fail in specific ways. Look at, in this order:

1. **Hands.** Count fingers, check how the phone is actually held.
2. **The phone in slot 3.** Generators drift to smartphones. If it has a touch
   screen, regenerate — the whole point of that section is that the senior
   needs no app.
3. **Eyes and teeth.** Too symmetrical, too white, too wet means regenerate.
4. **Text anywhere** — calendars, notebooks, signage. Generated text is
   gibberish and reads instantly as fake. Prefer frames with no legible text.
5. **Jewellery and fabric edges**, where generators smear.

## Citation — this is scored

The brief requires every asset to be cited, and a generated image needs a
provenance line as much as a licensed one. After adding each file, record it in
`datasets/MANIFEST.json` with the tool and model name, the date, the full
prompt, and a line stating the people depicted are **synthetic and not real
Samarth members**. Say the same in the pitch. Judges mark honesty about
limitations; an unlabelled generated person in a healthcare demo is the kind of
thing they would be right to punish.
