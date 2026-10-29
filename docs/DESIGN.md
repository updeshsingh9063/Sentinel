# Design system

Written for the team. Records where the visual language came from, what was
copied, and what must not be.

## Provenance

The token layer in `frontend/styles/design-system.css` is adapted from
**[elloreseniorliving.com](https://elloreseniorliving.com/)** — a luxury senior
living community in Santa Clara, California (Oakmont Management Group ×
Related California). Values were read out of their compiled theme stylesheet,
not estimated from screenshots.

Their system in one line: **light-weight, wide-tracked, uppercase bronze
headings over warm creams, with square corners.**

## What was copied

| Token | Ellore value | Notes |
|---|---|---|
| Signature accent | `#725927` | Bronze. 48 uses in their CSS — the single most-used colour after black and white |
| Accent variants | `#7f642c` `#836d51` `#86744f` | |
| Page grounds | `#fff9f4` `#fff6ee` `#f4ece1` `#e5d7bf` | Warm creams to sand |
| Neutrals | `#f6f6f6` `#e7e7e7` `#c1c1c1` `#363535` `#231f20` | |
| Validation | `#008435` `#e20909` `#f05656` | They reserve these for forms only, never decoration. We keep that rule |
| Heading treatment | weight 300, uppercase, `letter-spacing: .125rem` | The distinctive part |
| Heading scale | h1 `1.75rem`/`2.25rem`, h2 `1.5rem`/`2rem`, h3 `1.25rem`/`1.75rem` | |
| Line heights | `1.5` body, `1.75` relaxed | Their two dominant values |
| Radius | `0.125rem` (2px) | Essentially square; `50%` for avatars only |

Nineteen colours total. That restraint is the most useful thing to copy — one
signature accent doing all the work.

## Three deliberate divergences

**1. Fonts — forced.** Ellore licenses **GT America Extended** and **GT America
Standard** (Grilli Type) plus **Hallimun Signature**, a script face. All
commercial; we cannot ship them. Substitutes, both OFL via Google Fonts:

- **Archivo** → GT America Extended. Carries a real width axis
  (`extra-condensed` … `expanded`) and the same wide, slightly industrial
  grotesque character.
- **Inter** → GT America Standard, a neutral grotesque.

The script face is dropped rather than approximated. A free script
substitute reads quite differently and the accent is minor on their site.

**2. Base text size — a correction, not a preference.** Ellore's body copy is
**14px** (`0.875rem` is the single most common `font-size` in their CSS, with
`0.75rem` as the floor), and they ship a text-resize widget at 100/150/200% to
compensate. For an audience of seniors and families that is backwards: **the
default should be readable and the widget an enhancement.** Our base is 16px
for staff surfaces and 22px on senior surfaces (`.senior-scale`). The scaling
widget is still there, on top.

**3. Bronze is not a severity colour.** `#725927` is a brand accent. A
coordinator alert needing action today must not look like a brochure heading,
so urgency keeps its own ramp (`--urgent` / `--watch` / `--steady`). That ramp
is deliberately **not** red-amber-green: the brief forbids implying a clinical
severity the system cannot establish, and a traffic light reads as triage.

## Accessibility: what we changed about their widget

Their control is reimplemented in `frontend/components/ui/A11yBar.tsx` with
three fixes:

1. Ellore puts `role="button"` and `tabindex="0"` on `<li>` elements. That
   looks keyboard-accessible and is not — a real `<button>` handles Enter and
   Space, announces itself correctly, and needs no manual key handling. Ours
   are real buttons with `aria-pressed`.
2. Their bar is 5.5rem wide in the top-right with icon-only triggers.
   Discoverability matters more than restraint here, so ours carries visible
   text labels.
3. The choice persists to `localStorage`. Re-setting text size on every page
   load defeats the feature.

Scaling is one line: `:root[data-text-scale="150"] { font-size: 150%; }`.
Because every token is in `rem`, the whole interface follows with nothing
restyled per step.

### Measured contrast

Computed against WCAG 2.1, not assumed:

| Pair | Ratio | AA | AAA |
|---|---|---|---|
| Bronze `#725927` on cream `#fff9f4` | 6.34:1 | pass | fail |
| Bronze on white | 6.62:1 | pass | fail |
| Bronze on sand `#e5d7bf` | 4.66:1 | pass | fail |
| White on bronze (button) | 6.62:1 | pass | fail |
| Black on cream | 20.11:1 | pass | pass |

Bronze clears AA everywhere it is used but clears AAA nowhere. For body text
that is acceptable; for anything a low-vision user must read under pressure,
use `--text` on `--surface`, not the accent. The high-contrast mode drops to
pure black on white (21:1).

Bronze also fails AA on a dark ground, so the dark theme lifts the accent to
`#c9a35c`.

## What must never be copied

Design tokens — colours, scales, spacing — are not protectable, and
substituting the fonts resolves the only licensing issue. These are not ours:

- **Their fonts.** GT America and Hallimun Signature require a paid licence.
- **Their photography.** All of it is commissioned.
- **Their copy.** "Where Living Well Comes Naturally", "Beyond Expectations",
  "Live fully in your element" are Ellore's lines.
- **Their name, logo and marks.**

One more reason not to borrow their voice: Ellore is a **sales funnel** for an
affluent US market ($5,595/month). Aspirational luxury copy is vague by
design. Our family summaries must be concrete and non-diagnostic, and our
coordinator surface is an operational tool. Borrowing the look is fine;
borrowing the tone would work against the brief.

## Verification

```bash
cd frontend && npm run build   # 8 routes, fonts resolve, 105 kB shared JS
npx tsc --noEmit               # clean
```
