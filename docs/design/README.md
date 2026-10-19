# Calorie Counter: design handoff, direction B ("Halo", pine and lime)

This package holds the approved visual design for Calorie Counter, ready for Claude Code to build from. Direction B was picked on 19 October 2026.

**What decides what.** The build brief decides behaviour and the designs decide look and layout. If they conflict, ask Daniel. Known conflicts are listed under "Open decisions" below, each with a working default so the build isn't blocked.

- The build brief is the Claude Doc "Calorie Counter — Build Brief". A snapshot from 19 Oct 2026 is in `reference/`. If the live doc differs from the snapshot, the live doc wins.
- The design canvas, with every artboard, lives at https://claude.ai/artifact/STMvP4pXThd3FyKCHtm6BY. Only Daniel can open it; everything you need from it is in this package.

## What's in the package

```text
README.md                      this file
tokens/
  tokens.json                  source of truth: colour, type, spacing, radius, ring geometry
  build.mjs                    node tokens/build.mjs regenerates the four files below
  tokens.css                   CSS variables (--cc-*), light and dark, plus base and .cc-dock styles
  tailwind-theme.css           optional Tailwind v4 bridge (bg-surface, text-ink2, rounded-card, ...)
  tokens.ts                    the same values typed for TS, plus cssVar.theme / cssVar.pine
components/
  ring.ts                      ring maths and geometry: splitEnergy, ringGeometry, goalFractions
  EnergyRing.tsx               the ring with activity rail, macro segments, over lap and goal mini-map
                               (also exports RingCaption and MacroLegend)
  TargetBar.tsx                nutrient target row: at least / no more than / range / missing values
  format.ts                    en-AU number formats, salt from sodium, kJ and kcal
  Example.tsx                  usage with the design's sample day (not app code)
android/
  Colors.kt                    generated Compose colours (PineColors, LightColors, DarkColors)
  RingBitmap.kt                draws the widget ring to a Bitmap for Glance (not compiled; check it builds)
screens/
  index.html                   all screens on one page, light and dark side by side
  png/                         every designed screen at 2x, light and dark
  html/                        the same screens as static HTML with exact CSS, open in Chrome at 412 px
reference/
  build-brief-2026-10-19.md    snapshot of the build brief
```

The TypeScript compiles under `strict` with React 18 types, and the components were rendered and compared against the designs. The Kotlin hasn't been compiled because there was no Android SDK to hand.

## Getting started

1. Put `tokens/` and `components/` in the web app, for example `/app/design/tokens` and `/app/design/components`. The components import `../tokens/tokens`, so keep the two folders side by side or fix that one import.
2. Import `tokens.css` once, in the root layout. It sets the page background, the text colour and the font, and switches to dark with the system theme. Setting `data-theme="light"` or `data-theme="dark"` on `<html>` forces a theme.
3. Use Geist. Run `npm i geist`, then in `app/layout.tsx`:

   ```tsx
   import { GeistSans } from 'geist/font/sans';
   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return <html lang="en-AU" className={GeistSans.variable}><body>{children}</body></html>;
   }
   ```

   `tokens.css` picks up `--font-geist-sans` automatically. The font is OFL-licensed.
4. Add theme colours for the Android system bars and stop the WebView from darkening the page itself, because the app has its own dark theme:

   ```html
   <meta name="theme-color" content="#0D2F23" media="(prefers-color-scheme: light)">
   <meta name="theme-color" content="#081E17" media="(prefers-color-scheme: dark)">
   ```

   In the wrapper, give the activity a DayNight theme, so the WebView reports the system theme through `prefers-color-scheme`. Keep algorithmic darkening off: call `WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)` wherever `WebViewFeature.ALGORITHMIC_DARKENING` is supported.
5. Build the screens in the brief's stage order. Match them to `screens/png`. When you need an exact value (padding, size, colour), open the matching file in `screens/html` and inspect it. Everything there is plain inline CSS at 412 px wide.

To change a colour or size, edit `tokens/tokens.json` and run `node tokens/build.mjs`. Don't hand-edit the generated files.

## The rules of this direction

These keep the look consistent on screens that weren't designed.

1. **Lime only ever sits on pine.** Lime is light and highly saturated, so on sage or cream it looks washed out and fails contrast. In light mode the accent for links, focus and selection is forest `#2E6720`. Lime appears only on the hero band, the ring, the dock, the widget and dark mode.
2. **No white and no black.** Light mode has a sage page (`#E8F0E4`), cream cards (`#FBFBF2`) and pine ink (`#0B2D22`). Dark mode has a pine page (`#081E17`), pine surface cards (`#112921`) and mint ink (`#ECF7EE`).
3. **Each macro colour has two tunings.** The pastel tuning sits on pine: the ring, the widget and dark mode. The deep tuning sits on cream in light mode. The ring always sits on pine, so it always uses the pastel set, even in light mode. Protein is sky, carbohydrate apricot, fat lavender and other sage. Each colour means the same thing everywhere: ring, rows, dots, meal confirm and widget.
4. **Colour-blind safe.** The macros differ in lightness as well as hue. Warnings never rely on colour alone: they also use ▲, the words "over" or "left", and a hatched bar.
5. **Warnings, not walls.** The warning tone is coral on pine and terracotta on cream. It is never a full-colour fill or a blocking banner. Going over the energy target becomes a second lap in coral, and the centre number turns coral with ▲.
6. **Missing is not zero.** A missing value shows as "–". A target row with missing data gets a dashed "incomplete · n" chip. A log row whose food lacks a value gets a dashed chip such as "sat fat –". On label review, an unreadable field is a dashed empty field with the note "Unreadable in the photo".
7. **One primary action per screen.** Inside the dock, or anywhere on pine, the primary is a lime fill with a pine label. On cream it flips to a pine fill with a lime label. A secondary action is pine raised with a mint label. A disabled action is pine raised with a mint 3 label, never faded lime.
8. **The glass dock.** It sits 16 px above the bottom edge and content scrolls under it. Inside it are 52 px capsule buttons, 6 px padding, radius 34, and pine at 88% (82% pine raised in dark) with blur 24 and saturate 1.4. Use the `.cc-dock` class. Add enough bottom padding to the page to clear it, roughly dock height + 32 px.
9. **Everything is a capsule.** Fields are 48 px high with radius 24, chips 36–38 px with radius 18–19, cards radius 26, sheets radius 32, and the hero band has radius 36 on its bottom corners. Nested corners are concentric: inner radius = outer radius − padding.
10. **Type.** Geist throughout, with tabular figures for every number. See `tokens.type`: the dial is 76 / 300, the Today title 32 / 700, screen titles 30 / 600, figures 21 / 500, headlines 17 / 600, body 15–16 and captions 12–13. Caps labels are 12 / 600 with +8% tracking.
11. **Touch targets are at least 44 px.** List rows are 46–48 px.
12. **Calm.** No streaks, badges, confetti or motivational copy. Motion is quiet: the ring fills over about 600 ms with an ease-out, and sheets slide in over about 320 ms.

## The ring and the goal mini-map

`EnergyRing` draws everything in the brief's "Today's progress ring" section. It is drawn from layers, in this order:

1. **Track.** Mint at 10%, the full circle.
2. **Activity rail.** A thin lime line, 90% opacity, centred on the track. It runs from the base boundary (resting + goal adjustment) to 12 o'clock. It is 5 px on Today and 3 px on the widget, solid when activity is measured and dotted when estimated. Food segments cover it as you eat into the activity allowance.
3. **Segments.** These are cumulative arcs from 12 o'clock with round caps, drawn other → fat → carbs → protein, so each end sits over the next colour with a small pine shadow. The caps are compensated so each visible end lands exactly on its value. `splitEnergy()` applies the brief's segment maths (17 / 17 / 37 kJ per g, with any gap going to "other" and any excess scaled down), so the four parts always add up exactly to the energy logged.
4. **Over lap.** A second coral lap from 12 o'clock with a shadow at its tip.
5. **Goal mini-map** (the "halo"). A 3 px hairline 16 px inside the ring. It starts at 12 o'clock for the start weight, and the full circle means the goal weight. An arc runs to a solid dot for the current weight, and a hollow dot marks where you'd be today on pace. `goalFractions()` turns weights and dates into the two fractions and works whether the goal is to lose or to gain.

The **centre** shows kcal left with "1,460 of 2,180" under it. Over target, it shows "▲ KCAL OVER" in coral. When activity is estimated, the label reads "KCAL LEFT · EST.".

The **caption under the ring** (`RingCaption`) reads "2,180 target · +410 from activity", with a rail glyph that matches the ring and ", est." added when activity is estimated.

**Interactions.** Tapping the ring calls `onToggle`, which switches the centre to grams and share of energy. That view isn't designed (see "Open decisions"). The goal line under the ring ("Goal 84 kg by 20 Dec · now 86.6 · pace 86.2") is the link to the Goal screen.

**Sizes.** Today uses a 280 px ring with a 26 px stroke. The widget uses 136 / 15. The spec sheet uses 140 / 15.

## Nutrient target rows

`TargetBar` covers the brief's three directions, plus missing data:

| Direction | Bar | Caption |
| --- | --- | --- |
| At least (protein 150 g) | deep macro colour, fills to the target | "38 g to go", then "✓ Reached" |
| No more than (sat fat 7 g) | quiet sage below 90%; warning tone at 50% from 90% (6.3 g); hatched warning once over | "0.6 g left" in warning text; "▲ 19.7 g over" in bold |
| Range (carbs 150–250 g) | scale is 1.2 × max, with the band marked | "10 g below the range", "In range", "x g above the range" |
| Missing values | dashed "incomplete · n" chip after the name; a value of null shows "–" | — |

Sodium has no target in the sample. It shows as a figure with salt in brackets: `sodiumWithSalt(1240)` gives "1,240 mg (3.1 g salt)".

## Screen inventory

The designed screens are 412 px wide, each in light and dark.

| Screen | Status | Files | Notes |
| --- | --- | --- | --- |
| Design tokens | Designed | `00-tokens` | Palette, ring spec, type, spacing, radius, target rows, buttons and dock |
| Today | Designed | `01-today-light/dark` | Pine hero band (488 px, light mode only: in dark it merges into the page), weigh-in pill, ring, caption, goal line, macro legend, targets card, dock, sodium and more-nutrients card, LOG groups with ⋯ menus (Copy, Save these as a meal) |
| Today, over target and missing nutrient | Designed | `02-today-over-light/dark` | "Yesterday", 2,410 kcal, coral lap, sat fat 26.7 g over with "incomplete · 1", muesli row with "sat fat –" |
| Amount sheet | Designed | `03-amount-sheet-light/dark` | Bottom sheet over a scrim, amount capsule 104 px high with an 84 / 300 figure and a focus ring, kcal under it, chips, 3 × 3 nutrient tiles with today + this-amount bars, Save. The keypad is the system one (`inputmode="decimal"`, Enter saves) |
| Meal editor | Designed | `04-meal-editor-light/dark` | Tuesday pasta: ingredients card with gram pills, Sum / Cooked segmented control, Makes 5, nutrition per serve and per 100 g, "log from this meal" with chips, dock with Save meal and Log 300 g |
| Meal confirm | Designed | `05-meal-confirm-light/dark` | Photo with a glass hint pill and mic, Found card (gram pill, swap, remove), dashed unticked hidden-fat suggestion, totals, meal and time label, dock with Save as meal and Save |
| Label review | Designed | `06-label-review-light/dark` | Photo, Product card (name, serve, pack), per-100 g fields with sat fat unreadable, "Confirm adds it to the shared catalogue", Confirm |
| Widget | Designed | `07-widget-light/dark` | Real size, see below |
| Onboarding step 3: AI key | Designed | `08-ai-key-light/dark` | Three providers in alphabetical order with nothing selected, each with "Get a key" and a data-use line from config; the key field and Test stay disabled until a provider is picked; Skip for now, Save key (disabled) |
| Onboarding 1–2 (profile, goal) | Not designed | | Same shell as the AI key step: 36 px circular back button, step dots (current step ink in light, lime in dark), 30 / 600 title, an inset grouped card of fields, primary in the dock. The goal step shows the resulting daily target as a 21 / 500 figure line, and any warning as a cream card with a warning-text headline, ink 2 body, a "Continue anyway" secondary and a "Change goal" primary |
| Search | Not designed | | Search field capsule at the top (raised, 48 px, magnifier icon), keyboard up. Below it, Meals, Recent and Frequent as LOG-style grouped cards: rows of name, last amount in ink 2, kcal. A tap opens the amount sheet, prefilled when the query held an amount ("45 salad") |
| Meals | Not designed | | Grouped card list sorted by most recent use. Each row shows the name, then total weight and kcal per 100 g in ink 2, with a ⋯ menu (Edit, Duplicate). New meal is the dock primary |
| Scanner | Not designed | | Full-bleed camera with a pine scrim at 60% outside a 260 × 160 framing box (radius 24, lime corner strokes, which is fine because it sits on the scrim). Mint links for "Type barcode" and "No barcode? Photograph the label". A 44 px glass torch button. Meal / Label switch as a glass segmented control at the bottom |
| Food detail | Not designed | | Name as a 30 / 600 title, source and added-by line, per-100 g card like the meal editor's nutrition card, a measures card with an add row, "Fill gaps from label photo" as an accent link, dock with Edit and Log |
| Goal | Not designed | | Weight trend chart on a surface card: weigh-ins as ink 2 dots, trend line in ink, on-pace line dashed ink 3, goal as a horizontal accent line. "How your target is worked out" card listing resting, activity (measured or estimated, plus 7 days of burn), adjustment and target. Then dismissed warnings, and edit goal and profile |
| Trends | Not designed | | 7 / 30-day segmented control (same style as Sum / Cooked), then a table card of nutrient, daily average and target with TargetBar captions |
| Settings | Not designed | | Grouped cards with caps section labels. 48 px rows with values in ink 2 and chevrons. Switches: off is raised; on is a forest fill with a cream knob in light and a lime fill with a pine knob in dark. AI key section reuses the provider list from onboarding |
| Admin | Not designed | | Invite field and primary, users as a grouped list with Revoke as a warning-text button |

## Widget at real size

Values are in dp and were designed on a 412 dp-wide phone.

- **Card.** 380 × 220, radius 32, padding 14 / 18 / 14 / 14. The surface is pine band `#0D2F23` in light and pine surface `#112921` in dark. Use `ColorProvider(day, night)`.
- **Ring.** 136 with a 15 stroke and a 3 rail. Draw it with `RingBitmap.render()` and show it as an `Image`. The centre text is laid over it in Glance: "720" at 36 sp / light, then "KCAL LEFT" at 10 sp / semibold, tracked, in mint 2.
- **Nutrients.** Three are shown, chosen in Settings, stacked with 12 dp gaps. Each has a name line (12 sp, mint 2) and a value line (20 sp, mint, with a 13 sp mint 2 unit). The defaults are protein "112 / 150 g", "Saturated fat · 0.6 g left" in coral when near or over its limit, and "Sodium · 3.1 g salt" over "1,240 mg".
- **Buttons.** Four buttons in a row with 8 dp gaps: Scan, Photo, Search, Type. Each is a 48 dp capsule in pine raised `#1C352C` with a 22 dp mint icon. They open `/log/scan`, `/log/photo`, `/log/search` and `/log/type`.
- **Empty or stale day (not designed).** Show the track with no segments and "Nothing logged yet today" in mint 2 at 15 sp in place of the nutrients. Never show yesterday's numbers.
- **Font.** Glance can't load Geist, so use the system font.

## Open decisions

These are flagged for Daniel. Each has a working default so the build can go ahead.

1. **Near-limit tone.** The brief says "amber from 90%". The design uses the warning tone at half strength instead, because apricot is already the carbohydrate colour and an amber warning would read as carbs. Read the acceptance check "turns amber at 6.3 g" as "turns the soft warning tone at 6.3 g". Default: as designed.
2. **Above a range.** Not designed. Default: a warning-text caption ("12 g above the range") with no hatching. The over-limit treatment is kept for "no more than" targets.
3. **Pasta cooked weight.** The design shows a cooked weight of 1,850 g and makes 5 × 370 g. The brief's acceptance test uses 1,200 g. The design's numbers are only illustrative, so use the brief's for tests.
4. **Hint versus suggested oil.** The brief's own examples pair the hint "1 tbsp oil" with a suggested "1 tsp oil", and the design follows them. When the hint names the fat, it should probably become a found item at the stated amount rather than an unticked suggestion. Default: treat a fat named in the hint as a found item.
5. **"100 g" chip.** The amount sheet design has a "100 g" chip that isn't in the brief's chip list (last amount, serve, whole pack, meal serves, household measures). Default: leave it out unless Daniel wants it.
6. **Grams view of the ring centre.** Not designed. Suggested: three lines in macro colours, each "Protein 112 g · 31%" at 15 / 500, with "of energy" in mint 2 under them. Tap again to switch back.
7. **Mini-map reading.** The design uses the inner halo, which reads as goal progress (start, now, on-pace tick, goal). The brief marks this reading as needing confirmation. Because tapping the ring toggles the centre, the goal line under the ring is the way into the Goal screen.
8. **Missing-value chip wording on log rows.** The design uses "sat fat –". Default: abbreviated nutrient name followed by an en dash.
9. **Day navigation.** The brief asks for a swipe between days. The header changes between "Today" and "Yesterday" (and dates beyond that), but the gesture itself isn't drawn.
10. **App name.** "Calorie Counter" is still a working title.

## Sample data and assumptions

All of the numbers are illustrative and weren't computed from real foods.

- **Day.** Monday 19 Oct 2026. The target is 2,180 kcal: a base of 1,770 (resting + adjustment) plus 410 of measured activity.
- **Eaten.** 1,460 kcal: protein 455, carbs 569, fat 394, other 42.
- **Goal.** Started at 88.0 kg on 31 Aug, now 86.6 kg, aiming for 84 kg by 20 Dec. On pace would be 86.2 kg, so progress is 0.35 and pace is 0.44.
- **Over state.** Sunday 18 Oct: 2,410 kcal, saturated fat 26.7 g with one entry missing a value.

## Contrast

These are WCAG 2.x ratios for the main pairs. Every text pair passes AA (4.5:1).

| Pair | Colours | Ratio |
| --- | --- | --- |
| Light: ink on sage page | #0B2D22 on #E8F0E4 | 12.8:1 |
| Light: ink on cream card | #0B2D22 on #FBFBF2 | 14.3:1 |
| Light: ink 2 on cream | #496155 on #FBFBF2 | 6.5:1 |
| Light: forest accent on cream | #2E6720 on #FBFBF2 | 6.6:1 |
| Light: warning text on cream | #AE4024 on #FBFBF2 | 5.7:1 |
| Light: carbs bar on cream (not text) | #CE7C22 on #FBFBF2 | 3.1:1 |
| Light: ink 3 on cream (dividers, grabber only, never text or icons) | #9DB1A3 on #FBFBF2 | 2.2:1 |
| Lime on pine band | #C3F556 on #0D2F23 | 11.4:1 |
| Pine label on lime button | #081E17 on #C3F556 | 13.7:1 |
| Lime label on pine button | #C3F556 on #0B2D22 | 11.7:1 |
| Mint 2 on pine band | #ACC5B5 on #0D2F23 | 7.9:1 |
| Dark: ink on page | #ECF7EE on #081E17 | 15.8:1 |
| Dark: ink 2 on surface | #ACC5B5 on #112921 | 8.4:1 |
| Dark: ink 3 on surface | #7A9385 on #112921 | 4.7:1 |
| Dark: warning on surface | #FC8E72 on #112921 | 6.8:1 |
| Disabled label on pine raised | #7A9385 on #1C352C | 4.0:1 (disabled, exempt) |
