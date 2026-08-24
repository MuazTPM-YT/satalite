# SatAlite Studio — Frontend Audit

**Commit:** `dfdfdca` · **Branch:** `feat/wire-frontend` · **Date:** 2026-08-24
**Scope:** `frontend/src` — layout, responsiveness, motion, component structure
**Standard applied:** `emilkowalski/skills` (`review-animations`, `improve-animations`,
`find-animation-opportunities`, `emil-design-eng`, `animation-vocabulary`, `pick-ui-library`),
installed at `.claude/skills/`.

> **What this package is.** `emilkowalski/skills` is a set of *agent skills* — instruction files
> that set a craft bar for motion and interface work. It is not an npm runtime library, and this
> audit adds nothing to `package.json`. Every value cited below (cubic-beziers, durations, spring
> configs) is copied verbatim from the installed
> `.claude/skills/review-animations/STANDARDS.md`, not approximated.

---

## 0. Recon

| Aspect | Finding |
| --- | --- |
| Stack | Next.js 16.3.1 (App Router), React 19.2.8, Tailwind CSS 4.3.3 (CSS-first `@theme inline`) |
| Motion libraries | **None.** No Framer Motion, no React Spring, no GSAP |
| Motion tokens | **None.** No `--ease-*`, no `--duration-*` in `src/app/globals.css` |
| Total motion in `src/` | **6 declarations** — 5 `transition-colors` utilities + 1 `transition: border-color 0.15s ease` (`globals.css:76`) |
| `@keyframes` | 0 |
| `prefers-reduced-motion` | **0 occurrences** |
| `@media (hover: hover)` | **0 occurrences** — every hover style is ungated |
| Breakpoint utilities (`sm:`/`md:`/`lg:`/`@container`) | **0 occurrences across all of `src/`** |
| Personality | Crisp engineering dashboard. CAD-adjacent, information-dense, dark-only. Motion budget should be **small and fast** — this is not a place for delight |

### Frequency map

Severity below is driven by this table (`.claude/skills/improve-animations/AUDIT.md` §1).

| Surface | Frequency tier | Motion verdict |
| --- | --- | --- |
| Time scrubber drag (`TimeScrubber.tsx:26`) | Continuous, hundreds/session | **Never animate.** Every frame is a solved data frame |
| Section probe click (`Section2D.tsx:167`, `Viewer.tsx:141`) | Tens–hundreds/session | Near-imperceptible only |
| 3D orbit / camera presets (`Viewer.tsx:200-228`) | Tens/session | Already damped by OrbitControls; leave alone |
| 2D↔3D view toggle (`TopBar.tsx:64-78`) | Tens/session | Reduced motion only |
| Panel open/close (`TopBar.tsx:88-99` → `page.tsx:249-347`) | Occasional | **Standard animation — the highest-leverage target** |
| First load / solve (`page.tsx:226-229`) | Once per session | Eligible for a real entrance |

---

## 1. Prioritized findings

Ordered by leverage (impact ÷ effort). Every row was re-read at its cited `file:line` before
being listed.

| # | Severity | Category | Location | Finding | Fix summary |
| --- | --- | --- | --- | --- | --- |
| 1 | **HIGH** | Layout | `LeftPanel.tsx:170`, `ChecksPanel.tsx:31` | Fixed-width `<aside>` inside a resizable `react-rnd` panel — horizontal resize does nothing to the content | `w-full h-full`, drop `shrink-0` |
| 2 | **HIGH** | Layout | `page.tsx:31-33` | `ensemble`/`season`/`validation` spawn taller than the viewport on a 1280×800 laptop; they **jump** on first drag when `bounds="parent"` finally clamps them | Clamp spawn geometry to the container rect at open |
| 3 | **HIGH** | Interruptibility | `page.tsx:249-347` | Six palettes mount/unmount with zero transition — the single largest perceived-quality gap in the app | `@starting-style` enter, presence-gated exit |
| 4 | **HIGH** | Accessibility | whole codebase | Zero `prefers-reduced-motion` handling; every hover style is ungated for touch | Add both media queries before adding any motion |
| 5 | **MEDIUM** | Layout | `PourWindowTable.tsx:38` | 8-column table, `w-full`, no horizontal scroll container, inside a panel with `minW: 560` | Wrap in `overflow-x-auto` |
| 6 | **MEDIUM** | Cohesion & tokens | `globals.css` | No easing or duration tokens; 6 ad-hoc motion values | Add `--ease-out`/`--ease-in-out` to `@theme` |
| 7 | **MEDIUM** | Physicality | `TopBar.tsx`, `Viewer.tsx:36-38`, `LeftPanel.tsx:209` | No pressable element in the app has `:active` feedback | `scale(0.97)` @ 160ms |
| 8 | **MEDIUM** | Layout | `TopBar.tsx:53` | Three groups in one `justify-between` row with no `min-w-0`; `HealthProbe` (`max-w-[420px]`) is what gets squeezed, and its URL is the one thing worth reading | `min-w-0` on the center group |
| 9 | **MEDIUM** | Structure | 17 call sites | `text-[10px] font-semibold uppercase tracking-wider text-text-secondary` duplicated 17× | Extract one `<SectionLabel>` |
| 10 | **LOW** | Structure | `Section2D.tsx:11` | Imports `camClass` from `Viewer.tsx` — shared style crossing a component boundary sideways | Move to `src/components/styles.ts` |
| 11 | **LOW** | Structure | `LeftPanel.tsx:78-143` | `FormRow`/`SelectRow` are generic primitives trapped in a feature component | Promote to `src/components/Field.tsx` |
| 12 | **LOW** | Structure | `src/lib/test_*.ts` (5 files) | Node scripts (`process.exit`) inside `src/`, typechecked by `tsconfig.json`'s `**/*.ts` | Move to `frontend/scripts/` |

---

## 2. Layout & responsiveness — detail

Target per your decision: **laptop down to 1280px.** No tablet or phone layout.

### 2.1 Fixed-width content inside resizable panels — HIGH

```tsx
// src/components/LeftPanel.tsx:170 — current
<aside className="w-[260px] shrink-0 bg-bg-surface overflow-y-auto">

// src/components/ChecksPanel.tsx:31 — current
<aside className="w-[280px] shrink-0 bg-bg-surface overflow-y-auto">
```

Both are rendered as the `children` of a `FloatingPanel`, which is a `react-rnd` `Rnd` already
sized by `defaultGeo` and the user's drag (`FloatingPanel.tsx:54-69`). The `minW` values in
`PANEL_GEO` (`page.tsx:28-29` — `262` and `282`) exist only to keep these fixed widths from
clipping. Net effect: the panel has resize handles that do nothing horizontally.

```tsx
// target
<aside className="w-full h-full bg-bg-surface overflow-y-auto">
```

`minW` can then drop to a real content minimum. No prop, no state, no fetch is touched.

### 2.2 Panels spawn outside the viewport — HIGH

Available viewer height on a 1280×800 laptop: `800 − 44 (TopBar h-11) − ~36 (TimeScrubber) ≈ 720px`.

| Panel | `y + h` (`page.tsx`) | Needs | Overflow at 720px |
| --- | --- | --- | --- |
| `validation` (`:33`) | `30 + 800` | 830px | **+110px** |
| `season` (`:32`) | `40 + 760` | 800px | **+80px** |
| `ensemble` (`:31`) | `60 + 700` | 760px | **+40px** |
| `checks` (`:29`) | `16 + 560` | 576px | fits |
| `pour` (`:30`) | `320 + 300` | 620px | fits |

`bounds="parent"` (`FloatingPanel.tsx:61`) constrains *dragging*, not the initial `default` — so
the panel opens overflowing and then **snaps** the moment you grab its title bar. That snap is the
visible symptom users will report.

Horizontally, `checks` needs `950 + 282 = 1232px`, which fits at 1280 with 48px to spare and clips
below ~1232px.

Fix: compute spawn geometry against the container's measured rect instead of hardcoding it —
clamp `h` to `rect.height − y − 16` and `x` to `rect.width − w − 16`.

### 2.3 Wide tables have no scroll container — MEDIUM

`PourWindowTable.tsx:38` is `<table className="w-full text-xs">` with eight columns, headers as
long as `max_core_temp_anywhere_c` and `peak_evaporation_kg_m2_h`. Its panel's `minW` is `560`
(`page.tsx:30`). At that width the columns compress into unreadable wrapping. `SeasonPanel.tsx:116`
has the same shape.

Wrap the `<table>` in `<div className="overflow-x-auto">`. Markup-only; the `candidates` prop and
its `.map()` are untouched.

### 2.4 TopBar has no shrink priority — MEDIUM

`TopBar.tsx:53` puts logo, the 2D/3D pill group, six launcher buttons, a unit `<select>`, and
`HealthProbe` in one `justify-between` row. Nothing declares `min-w-0`, so flex refuses to shrink
below content width and `HealthProbe`'s `truncate` (`HealthProbe.tsx:41`) eats the API URL first —
the most diagnostic text in the bar. Add `min-w-0` to the center group and let the probe shrink
last.

### 2.5 `body { overflow: hidden }` — noted, not a finding

`globals.css:58` plus `h-screen` (`page.tsx:203`) means anything that does not fit is unreachable
rather than scrollable. For a viewer app this is the correct trade — but it is exactly why 2.2
matters: there is no scrollbar to rescue an overflowing palette.

---

## 3. Motion review

### Part 1 — Findings table

Required format per `.claude/skills/emil-design-eng/SKILL.md` §"Review Format".

| Before | After | Why |
| --- | --- | --- |
| No easing tokens in `globals.css` | `--ease-out: cubic-bezier(0.23, 1, 0.32, 1); --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);` in `:root` + `@theme inline` | Built-in CSS easings are too weak; curves belong in the token layer next to the existing color tokens |
| `transition-colors` (bare, `TopBar.tsx:23`) | `transition-colors duration-150 ease-[var(--ease-out)]` | Tailwind's default 150ms `ease` is unspecified intent; hover/color change should read as a decision |
| `transition: border-color 0.15s ease` (`globals.css:76`) | `transition: border-color 150ms var(--ease-out)` | Same value, named curve — one vocabulary instead of two |
| `{openPanels.element && <FloatingPanel …>}` (`page.tsx:249`) | `@starting-style { opacity: 0; transform: scale(0.97); }` + `transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out)` | Palettes appearing with no bridge read as broken; occasional-frequency tier earns a standard animation |
| Panel unmounts instantly on close (`page.tsx:194-196`) | Presence state so the element survives its own unmount, exit at 150ms | Exit is a system response — it snaps; enter is the deliberate act |
| No `transform-origin` on any palette | `transform-origin` at the launching TopBar button | Palettes are trigger-anchored, not modals — they should grow out of the icon that opened them |
| No `:active` on any button (`TopBar.tsx:20-31`, `Viewer.tsx:36-38`, `LeftPanel.tsx:209`, `Section2D.tsx:273`) | `:active { transform: scale(0.97) }` with `transition: transform 160ms var(--ease-out)` | Buttons must feel responsive to press; subtle (0.95–0.98) |
| Ungated `hover:` on every interactive element | Wrap hover motion in `@media (hover: hover) and (pointer: fine)` | Touch fires false hovers on tap — cheap to add now, painful to retrofit |
| No `prefers-reduced-motion` block | `@media (prefers-reduced-motion: reduce)` keeping opacity, dropping transform | Reduced motion means gentler, not zero |
| `"solving…"` bare text (`page.tsx:228`) | Same text, opacity-pulse ≤ 2s, no layout movement | Perceived performance: the first thing a user sees currently looks like a hang |

### Part 2 — Verdict by tier

**1. Feel-breaking regressions** — none. There is no bad motion here, because there is
effectively no motion. This is a blank slate, not a cleanup.

**2. Missed simplifications** — none to remove. The six existing `transition-colors` are
correctly scoped (hover/color only) and correctly absent from the time scrubber and the R3F canvas.

**3. Performance** — clean. No `transition: all`, no animated layout properties, no `scale(0)`,
no rAF tweens outside `OrbitControls`' own damping (`Viewer.tsx:~90`, `dampingFactor={0.12}`),
which is correct for orbit.

**4. Interruptibility & timing** — the whole gap is here. Six conditionally-mounted palettes
(`page.tsx:249-347`) toggled from a persistent toolbar is the textbook case for CSS transitions
with `@starting-style` over keyframes: a user spamming a launcher must see the panel retarget from
its current state, not restart from zero.

**5. Origin, physicality & cohesion** — palettes have no spatial story. They are launched from a
specific 28×28px button in `TopBar.tsx:88-99` and appear at an unrelated hardcoded coordinate.
Setting `transform-origin` toward the launching button costs nothing and answers "where did this
come from".

**6. Accessibility** — the one place this audit is not merely aesthetic. Zero
`prefers-reduced-motion`, zero hover gating. Both must land in the same change as the first
animation, not after it.

**Decision: no block, but no approval either.** There is nothing to reject and nothing to praise.
The correct next step is finding #3 plus finding #4 together.

---

## 4. Animation opportunities

Gated through all four questions in `.claude/skills/find-animation-opportunities/SKILL.md`.
Five survived.

| # | Location | Today | Purpose | Frequency | Suggested motion |
| --- | --- | --- | --- | --- | --- |
| 1 | `page.tsx:249-347` | Palettes appear and vanish instantly | Preventing a jarring change | Occasional | Enter: `@starting-style { opacity: 0; transform: scale(0.97) }` → settled, `transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out)`, `transform-origin` at the TopBar launcher. Exit: same properties at 150ms |
| 2 | `TopBar.tsx:20-31`, `Viewer.tsx:36-38`, `LeftPanel.tsx:209`, `Section2D.tsx:273` | No press state anywhere | Feedback | Tens/day | `:active { transform: scale(0.97) }`, `transition: transform 160ms var(--ease-out)`, gated behind `@media (hover: hover) and (pointer: fine)` |
| 3 | `page.tsx:226-229` | `"solving…"` then a hard swap to the full viewer | Preventing a jarring change | Once/session | Fade the resolved viewer in over 200ms `var(--ease-out)`, opacity only — never move solved geometry |
| 4 | `Viewer.tsx:262-269` | Hover chip pops in at cursor position | Feedback | Tens/session | Opacity-only, 125ms `var(--ease-out)`. **No transform** — it tracks the cursor; transform would fight the position update |
| 5 | `Viewer.tsx:271-280` | Probe popup appears with no entrance | Spatial consistency | Tens/session | `opacity: 0; scale(0.96)` → settled at 150ms `var(--ease-out)`, `transform-origin` toward the clicked point already computed at `Viewer.tsx:148-152` |

### Part 2 — Rejected candidates (required)

- `TimeScrubber.tsx:26` — animating the section as frames change. **Rejected: this is the core
  interaction, dragged continuously, and every frame is solved data. Motion here would invent
  intermediate states the solver never produced.** This is the most important rejection in the audit.
- `Section2D.tsx:189-260` — animating the contour bands or a draw-on reveal of the section outline.
  **Rejected: functional data the user is reading and clicking to probe. Decoration hinders.**
- `HistoryChart.tsx` — animated line drawing. **Rejected: same reason. An engineer reading a
  temperature history should never wait for it.**
- `TopBar.tsx:64-78` — 2D↔3D toggle pill slide. **Rejected: tens/day tier, and the two views are
  entirely different renderers (SVG vs a WebGL canvas). A sliding pill would promise a continuity
  that does not exist.**
- `PourWindowTable.tsx:52` — staggered row entrance. **Rejected: it is a data table inside a panel
  the user opened deliberately to read numbers. Stagger would delay the answer.**

### Part 3 — Verdict

This interface needs **very little** motion, and it is right to have almost none today. It is a
functional engineering tool where the data must never move for style — and the audit's most
valuable output may be the rejection list, not the suggestion list. Exactly one seam is genuinely
broken: **six palettes that pop in and out of existence with no bridge (#1)**. That is the whole
job. Everything else on the table is a 160ms press state and two opacity fades.

---

## 5. Library recommendations (`pick-ui-library`)

Checked against `package.json` first, per the skill's step 2. **No dependency is added by this
audit** — these are recommendations pending a separate decision.

| Task in this codebase | Curated pick | Verdict |
| --- | --- | --- |
| Palette enter/exit (`page.tsx:249-347`) | plain CSS | **Use CSS, not a library.** `@starting-style` + presence state covers it. `motion` earns its weight only for springs, layout animations, or gestures — none needed here |
| Draggable/resizable palettes (`react-rnd`) | — | **Keep `react-rnd`.** Not on the curated list, already installed, and working. `dnd kit` is for sortable drag-and-drop, a different problem |
| `HistoryChart.tsx` (266 lines of hand-rolled SVG) | `recharts` | **Worth evaluating.** Static/interactive dashboard chart — the list's clear answer. Weigh against the fact that the hand-rolled version already shares `tempToColor` and the frame index with the viewer |
| `SeasonPanel.tsx:255-262` inline bar chart | `recharts` | Same call as above; decide both together or neither |
| Conditional `className` strings (`TopBar.tsx:20-31`, `Viewer.tsx:36-38`) | `clsx`, or `cva` for the variant-shaped ones | The `tabClass`/`panelIconClass`/`camClass` helpers are active/inactive ternaries returning whole class strings — exactly what `cva` types properly |
| Custom `input[type=range]` styling (`globals.css:88-133`) | — | **Keep.** Native range with `writingMode: vertical-lr` (`Viewer.tsx:246-254`) is the right primitive; no library beats it |
| `let zTop = 100` module global (`FloatingPanel.tsx:9`) | `zustand` | **Not yet.** One integer, one mutation site. It becomes a `zustand` case if panel state grows (persisted geometry, saved layouts) |

---

## 6. Constraint check — data-fetching and state

This is the check every recommendation above had to pass.

**Fetching surface**, all of it:

| Location | What |
| --- | --- |
| `page.tsx:68-76` | `loadSeason()` — `let live` cancellation guard |
| `page.tsx:80-88` | `loadValidation()` — same guard |
| `page.tsx:92-119` | `loadDemoRun()` → chained `loadPourWindows()` — same guard |
| `page.tsx:164-174` | URL-param IFC fetch → `runImport` |
| `HealthProbe.tsx:22-30` | `getHealth()` on mount — same guard |

**State surface:** every piece is a `useState` in `StudioPage` (`page.tsx:44-65`), pushed down as
props. No context, no store, no reducer. `ChecksPanel`, `PourWindowTable`, `EnsemblePanel`,
`SeasonPanel` and `ValidationPanel` are pure presentational consumers that fetch nothing.

**Therefore:** findings 1, 4–12 and opportunities 2–5 are **presentational only** — className
strings, CSS tokens, media queries, and one extracted component. None moves a `useState` call,
changes a prop shape, or touches `src/lib/api.ts` or `src/lib/scenario.ts`.

Three places where a careless restyle *would* break behavior:

1. **`FloatingPanel.tsx:41-51`** — the `useSyncExternalStore` hydration guard. The comment
   documents a real react-rnd SSR mismatch (`translate(90px, 40px)` vs `translate(90px,40px)`).
   Any enter animation must live **inside** that guard. Removing it to "simplify" reintroduces
   panels positioned by the server's markup. `improve-animations` Hard Rule 5: this is a settled
   decision, respect it.
2. **`page.tsx:249-347`** — conditional mounting. An exit animation needs the element to outlive
   its own unmount, which means new presence state in `StudioPage`. That is **additive UI state**
   and must stay strictly separate from `openPanels`, which `TopBar` reads for its `aria-pressed`
   (`TopBar.tsx:94`). Coupling the two would leave launcher buttons lit during the exit.
3. **Finding 2's spawn clamp** — reads a container rect, so it needs a ref and a measurement at
   open time. Keep it out of the `PANEL_GEO` constant and out of the fetch effects.

---

## 7. Recommended order

1. **Finding 1** — `w-full h-full` on the two `<aside>`s. Two lines. Panel resize starts working.
2. **Finding 4 + finding 6** — motion tokens and the two media queries in `globals.css`, *before*
   any animation exists to retrofit.
3. **Finding 2** — clamp panel spawn geometry.
4. **Finding 3 / opportunity 1** — palette enter/exit. The single highest-leverage change.
5. **Findings 5, 8** — table scroll containers, TopBar shrink priority.
6. **Opportunity 2** — `:active` press feedback, once the tokens from step 2 exist.
7. **Findings 9–12** — structural cleanup, any time; independent of everything above.

## 8. Verification

- Mechanical: `npm run lint` and `npm run build` from `frontend/`.
- Layout: `npm run dev`, resize to **1280×800**, open Validation → confirm it currently overflows
  the bottom and snaps upward on first title-bar drag. Open Element → drag its right edge →
  confirm the content does not follow.
- Feel check (after step 4): DevTools Animations panel at 10% playback — the palette scales from
  the launcher, not from center; spamming a launcher retargets instead of restarting from zero.
  Then Rendering → *Emulate prefers-reduced-motion* → movement gone, opacity feedback kept.
