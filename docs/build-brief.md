# Calorie Counter — Build Brief

Oct 19, 2026 · @Daniel

## What we're building

An invite-only food logger for Daniel and a few friends: barcode scan, meal photo, label photo, search and typed entry, tracking the full Australian nutrition panel rather than just calories. It runs as a Next.js web app on Vercel with Supabase, wrapped for Android with a home-screen widget and Health Connect sync. All data sources are free.

The one thing it must do better than MyFitnessPal: **entering an amount in grams is never more than typing the number.** Section "Entering amounts" is the core of the product; treat it as such.

**Design comes first.** Claude Design sets the visual direction and designs the key screens before any code is written. Claude Code builds to the approved designs: the designs decide look and layout, this brief decides behaviour, and where they conflict, ask.

### Rules that apply everywhere

1. **Nutrients only come from data, never from AI guesses.** AI may identify foods, estimate grams, read numbers off a label photo, or parse typed text. Nutrition values per 100 g always come from a database row or from a label the user has confirmed.
2. **Missing is not zero.** If a source lacks a value (say, saturated fat), store `null`, show "–", and flag day totals as incomplete. Never fill with 0.
3. **Grams are the default unit everywhere.** Other units (ml, serves, household measures) are shortcuts that convert to grams, never a required step.
4. **Log entries keep a snapshot.** Each entry stores the nutrient values it was logged with, so editing a food or meal later never rewrites history.
5. **Every AI-read label goes into the shared catalogue.** Once anyone's AI has read a product's panel, it's saved for all users, so nobody pays to read it twice. Before any AI call on a label, check the catalogue by barcode first.
6. **No AI provider is preferred.** Claude, Gemini and DeepSeek are offered as equals, in the same words and layout, with nothing pre-selected.
7. **AI keys never reach the browser.** Each user's key is stored encrypted and used only inside Vercel server routes.
8. **No AI key, no AI features; everything else still works.** Search, barcode, manual label entry and meals never depend on AI.
9. **Warnings, not walls.** Guardrails on goals and targets are advice the user can dismiss. The app refuses only what the arithmetic makes impossible.
10. **Invite-only.** Supabase Auth with email invites, public sign-up switched off, row-level security on every user-owned table.

## Users, invites and AI keys

Invite-only for Daniel and friends, as with Elevate and Unvice. Where those apps already have invite and API-key code, reuse that pattern rather than inventing a new one.

### Invites

- Daniel has an admin role. On the Admin screen he enters an email; a server route sends a Supabase invite using the service key; the friend sets a password and lands in onboarding.
- Public sign-up is off. The Admin screen lists who has joined and can revoke access.
- Onboarding: profile and goal (see "Goals and targets"), then the AI key step, which can be skipped.

### Bring your own AI key

- Each person adds their own key in Settings, choosing one of three providers shown as equals: **Claude** (Anthropic), **Gemini** (Google) or **DeepSeek**. Same layout, same wording, nothing pre-selected, nothing marked as recommended. A "Test key" button makes a tiny call and shows pass or fail.
- Keys are stored encrypted (Supabase Vault, or AES-GCM with a server secret). After saving, only the last four characters are ever shown, and the key can be deleted any time.
- The model used for each provider lives in config, not code: that provider's current small model that accepts images. Model names change often; the config is the one place to update.
- **The key screen says, in the same words for every provider:** an AI chat subscription does not include API access; API keys are separate and billed per use; here is where to get one (link per provider); and a one-line note of that provider's data-use terms for API traffic (some free tiers let the provider use prompts and images to improve their models). Those notes live in config so they can be kept current.
- **Without a key:** search, barcode, manual label entry and meals all work. The Photo and Type buttons show "Add an AI key to use this" and link to Settings.

### Shared and private data

| Shared with all users | Private to each user |
| --- | --- |
| FSANZ and Open Food Facts foods. **Every food created from a label**, whether read by AI or typed in, with or without a barcode. The catalogue records who added each food and when, and keeps the label photo as evidence | Food log, weigh-ins, profile, goal, targets, meal photos, meals, edited copies of foods, AI key, Recent and Frequent lists |

Editing a shared food creates a private copy, as with FSANZ foods. Which foods each person logs is tracked per person (`user_food_stats`), so everyone gets their own Recent and Frequent lists from the one shared catalogue. If two people add the same barcode, the first entry is kept and the second person is shown it instead. Duplicates without a barcode are tolerated in v1; a merge tool for Daniel's Admin screen is phase 2.

Open Food Facts limits apply per server address, so all users share 15 lookups a minute. That's fine for a handful of friends; if limits are hit, move lookups into the browser, where the limit applies per person.

## Nutrients tracked

Track the nine values on an Australian nutrition panel, stored per 100 g in fixed columns. Store energy canonically in kJ (that's what Australian sources use) and display kcal by default with a kJ toggle in settings.

| Nutrient | Column (per 100 g) | Display | Open Food Facts field | Health Connect field |
| --- | --- | --- | --- | --- |
| Energy | `energy_kj` | kcal (kJ ÷ 4.184), or kJ | `energy-kj_100g` (fall back to `energy-kcal_100g` × 4.184) | `energy` |
| Protein | `protein_g` | g | `proteins_100g` | `protein` |
| Fat, total | `fat_g` | g | `fat_100g` | `totalFat` |
| Saturated fat | `sat_fat_g` | g | `saturated-fat_100g` | `saturatedFat` |
| Trans fat | `trans_fat_g` | g | `trans-fat_100g` | `transFat` |
| Carbohydrate | `carbs_g` | g | `carbohydrates_100g` | `totalCarbohydrate` |
| Sugars | `sugars_g` | g | `sugars_100g` | `sugar` |
| Dietary fibre | `fibre_g` | g | `fiber_100g` | `dietaryFiber` |
| Sodium | `sodium_mg` | mg, with salt in brackets (sodium × 2.5) | `sodium_100g` × 1000 (it's in grams) | `sodium` |

Notes for implementation:

- **Salt:** Australian labels list sodium, not salt. Show "Sodium 1,240 mg (≈ 3.1 g salt)" so both are visible.
- **Carbohydrate convention:** Australian and Open Food Facts carbohydrate figures exclude fibre (unlike US labels). Don't mix in US-convention data.
- **Extras:** the FSANZ datasets carry 58 nutrients. Keep everything beyond the nine in an `extra_nutrients` JSON column so it can be surfaced later (iron, calcium, potassium) without a re-import. Not shown in v1.
- **Completeness:** each food gets a computed `missing_nutrients` list. A day total is "complete" only if no logged entry is missing that nutrient; otherwise show the total with a small "incomplete" marker and the count of entries missing it.

## Goals and targets

Like MyFitnessPal, the daily energy target comes from your body and your weight goal. Nutrient targets, such as protein and saturated fat, are set separately. Both are set in onboarding and editable on the Goal screen and in Settings.

### Profile and weight goal

- **Profile:** date of birth (so age stays current), sex, height, current weight. The form explains in one line that sex and height are needed by the calorie formula.
- **Activity level**, in plain words: mostly sitting; on your feet some of the day; active job or daily exercise; very active. Only used when no measured burn is available (see below); the form says so.
- **Goal:** target weight and target date.
- **Weigh-ins:** logged from the Today screen (tap, type weight, Save). The latest weigh-in drives the target.

### Daily energy target

1. **Resting energy** (Mifflin-St Jeor): 10 × kg + 6.25 × cm − 5 × age, then +5 for males or −161 for females.
2. **Activity, measured where possible:** today's active calories burned from Health Connect. Daniel's Garmin sends active and total calories burned to Health Connect through the Garmin Connect app (one-way, Android 14 or later). Google Fit's developer API closed in June 2025, so Health Connect is the only route. If a source gives only a total, activity = total − resting. With no burn data at all, activity is estimated from the activity level (resting × 0.2, 0.375, 0.55 or 0.725 for the four levels) and marked as estimated.
3. **Daily adjustment** = (target kg − current kg) × 7,700 kcal ÷ days left.
4. **Target = resting + activity + adjustment**, rounded to the nearest 10 kcal. With measured activity the target grows through the day as burn arrives, and the ring shows the activity part separately (see "Today's progress ring"). Recalculate after every weigh-in and burn sync. The Goal screen says whether activity is measured or estimated and shows the last 7 days of burn.
5. **Stable mode** (Settings toggle, off by default): use the 7-day average of total burn as the whole-day figure instead of today's live burn, for anyone who prefers a target that doesn't move during the day.

Be honest in the UI about precision. Watch estimates of calories burned are often 20–30% out, the formulas are population averages, and 7,700 kcal per kg is a rule of thumb that overstates loss over longer periods as the body adapts. Judge progress by the real weight trend, and show targets as round numbers.

Guardrails are advice, not walls. The app warns once, the person decides, and the app records that they chose to continue. It refuses only what the arithmetic makes impossible.

- **Warn, then allow.** A goal needing faster change than 1% of body weight a week shows "Faster than most people can sustain; at 1% a week you'd get there by \[date\]" with a Continue anyway button. A target below 1,200 kcal (females) or 1,500 kcal (males) shows "Below the level usually advised without medical supervision" with Continue anyway. Both thresholds are editable in Settings. A dismissed warning doesn't return unless the goal changes.
- **Refuse only the impossible.** A target date that has already passed, or a goal whose required daily deficit exceeds maintenance (which would mean eating less than nothing; losing 3 kg a week lands here for almost everyone). Show the earliest date the goal is reachable at a 1,000 kcal daily deficit and ask for a new date or weight.
- **Own numbers always allowed.** Anyone can type their own energy target or any nutrient target in place of a calculated or suggested one, with no warning at all.

Later (phase 2): adjust the target from two or three weeks of logged intake against the weight trend, which corrects for formula error.

### Nutrient targets

Any nutrient can have a target, with a direction:

| Direction | Example | How it shows |
| --- | --- | --- |
| At least | Protein 150 g a day | Bar fills toward the target; a tick when reached |
| No more than | Saturated fat 7 g a day | Bar shows headroom left; amber from 90%, a stronger warning tone once over |
| Range | Carbohydrate 150–250 g | The band is marked on the bar |

No nutrient targets are preset. If targets contradict the energy target (a protein minimum that alone exceeds it), show a one-line warning but don't block.

## Today's progress ring

The top of the Today screen. Design decides how it looks; it must show the following.

- **Main ring:** progress toward today's energy target. The filled arc is split by where the energy came from: protein, carbohydrate, fat, and a small "other" segment (fibre, alcohol, label rounding).
- **Activity on the ring:** the target's track is drawn in two parts: the base (resting + goal adjustment) and the part added by today's activity burn, drawn as a quieter, visibly different track segment at the end (lighter, or hatched). You can see how much of today's allowance came from moving, but it never competes with the eaten arc. Measured activity is solid; estimated activity is dashed and labelled "est." A single line under the ring reads, for example, "2,180 target · 410 from activity".
- **Segment maths:** use the Food Standards Code energy factors (protein 17 kJ/g, carbohydrate 17 kJ/g, fat 37 kJ/g). If the three add up to less than the logged energy, the gap is "other". If they add up to more (label rounding), scale them down proportionally so they match the logged total.
- **Centre:** kcal left (or over), with eaten and target in smaller text. Tap to switch to grams and share of energy for each macro.
- **Over target:** the ring keeps going as a second lap in a warning tone, so overshoot is visible without alarm.
- **Mini-map:** a small secondary marker beside or inside the ring showing the whole goal: start weight, current weight, goal weight, and a tick for where you'd be today if on pace. Tap opens the Goal screen with the weight trend chart. This reading of "mini-map" needs confirming; Design should show options.
- **Colours:** one fixed colour per macro, used everywhere (ring, nutrient rows, meal confirm, widget), and distinguishable for colour-blind users (never red against green alone).
- Under the ring: the nutrient rows with their targets.

## Data sources

Everything goes into one `foods` table in Supabase, tagged by source. Build each source as a separate import adapter that maps into the same columns, so new Australian datasets can be added without touching the app.

| Source | Used for | How it gets in | Lookup order |
| --- | --- | --- | --- |
| Each person's own foods and meals | Edited copies, custom foods, meals | Created in-app, private | 1 for that person |
| Shared catalogue of label-read foods | Any product someone has photographed or typed the panel for | Created in-app, shared with everyone | 2 for barcodes and search |
| [FSANZ Branded Food Database](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/branded-food-database) | Packaged foods by barcode, supplied by brand owners | **Not published yet** (FSANZ says a subset will be released as a searchable site and downloadable files). Build the adapter interface now; implement when files appear | 3 for barcodes, once available |
| [Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) | Packaged foods by barcode | Live lookup on first scan, then cached in `foods` | 4 for barcodes |
| [AUSNUT 2023](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut/data-files) | Foods as Australians eat them (3,741 foods) plus 9,816 portion measures | One-off import from Excel | 3 for search |
| [Australian Food Composition Database, Release 3](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/australian-food-composition-database-download-excel-files) | Raw ingredients, lab-analysed (about 1,588 foods) | One-off import from Excel | 4 for search |
| AI reading of a label photo | Last resort for a barcode nothing above has | The user's own AI key; the result is saved to the shared catalogue | 5 for barcodes, never repeated for the same product |

### Import details

- **FSANZ files:** Daniel downloads them manually (FSANZ requires accepting a licence on download) into `data/raw/`. Write idempotent import scripts in `scripts/` that upsert by source ID, so re-running after a new release updates rather than duplicates. Import AUSNUT's food details, nutrient profiles and food measures; AFCD's food details and nutrient profiles. Inspect the actual column headers before mapping.
- **Display names:** FSANZ names are long ("Banana, cavendish, peeled, raw"). Keep the original for search; add an editable `display_name` that defaults to the original.
- **Open Food Facts rules:** use the v3 product endpoint, request only the fields needed, and send a User-Agent of `CalorieCounter/0.1 (daniel's email)`. Use the staging server during development. Limit is 15 product lookups per minute; **never call their search endpoint** (10 a minute, and they ban type-ahead use). All name search runs on our own database.
- **Barcodes:** normalise before lookup and storage (a 12-digit UPC-A and its 13-digit EAN form with a leading zero are the same product).
- **Incomplete Open Food Facts records:** if a product has no energy value, treat it as a miss and go to the label photo flow. If it has energy but lacks other nutrients, use it, store nulls, and offer "Fill gaps from label photo" on the food.
- **Attribution:** an About screen crediting FSANZ (AUSNUT 2023, AFCD) and Open Food Facts (Open Database License).
- **Later (phase 2):** bulk-import the Australian subset of the [Open Food Facts data export](https://world.openfoodfacts.org/data) so packaged products are searchable by name. The full export is several gigabytes, so filter by country during import.

## Entering amounts (the MyFitnessPal fix)

The problem: in MyFitnessPal, logging 45 g of salad means changing a default "1 serve (30 g)" to 1 g units and then typing 45. Here, **choosing a food opens an amount field already in grams with the keypad up; typing 45 and tapping Save is the whole job.**

### The amount sheet

Every flow that lands on a single food or meal (search result, barcode hit, confirmed label, a saved meal) opens the same bottom sheet:

1. **Food name** and a small source tag (Mine, FSANZ, Open Food Facts).
2. **A large amount field, focused immediately**, numeric keypad open (`inputmode="decimal"`), unit shown as "g" beside it. If you've logged this food before, it's prefilled with your last amount and fully selected, so typing replaces it. Otherwise empty.
3. **Shortcut chips** under the field, each showing its gram value, at most five, in this order: your last amount; the pack's serve size; whole pack; for a meal, one serve, half and the whole meal; the most-used household measures from AUSNUT ("1 cup · 40 g", "1 medium · 120 g"). Tapping a chip fills the field. Tapping the same measure chip again adds another ("2 × 1 cup · 80 g").
4. **Live nutrition preview** for the amount entered: energy plus all eight other nutrients in a compact grid, updating on every keystroke, with a thin bar showing how much of today's target each uses where a target is set.
5. **Save** (also the keypad's Enter key). Time defaults to now and meal to time of day, shown as a small tappable label; changing them is never required.

The target for any known food: tap it, type the grams, tap Save.

### Other units

- **Millilitres** appear as a toggle only for drinks and other liquids. Convert using AUSNUT's density where available; otherwise assume 1 g/ml and mark the entry as estimated.
- The sheet **remembers the last unit per food**, so milk stays in ml once you've chosen it.
- No "serves" unit selector. Serves are chips that fill in grams.

### Amount typed with the search

The search box accepts an amount with the food: "45 salad", "salad 45g", "250ml milk". Strip the number and unit, search on the rest, and open the chosen food's sheet with the amount prefilled. Then it's tap the result and Save.

### Editing

Tapping any logged entry reopens the same sheet. Changing the grams recalculates from the snapshot's per-100 g values.

### Later (phase 2): weigh before and after

For eating out of a container: enter the starting weight, then the finishing weight, and log the difference.

## Logging flows

Five ways in, plus your saved meals, and every one ends at the amount sheet (one food or meal) or the meal confirm screen (several foods). Nothing is saved without one of those two screens.

### 1. Search

- Type-ahead against Supabase only, results within about 150 ms of the last keystroke.
- Ranking: foods you've logged (by how often and how recently), then match quality, then source priority (Mine > FSANZ Branded > Open Food Facts > AUSNUT > AFCD).
- Before typing, the screen shows **Recent** and **Frequent** foods, each with its last amount, so a repeat food is one tap plus Save.
- Use Postgres full-text search plus `pg_trgm` for typo tolerance ("brocoli").

### 2. Barcode

1. Camera opens with the browser's built-in barcode reader (`BarcodeDetector`, formats `ean_13`, `ean_8`, `upc_a`, `upc_e`). If it's unavailable, show a field to type the digits.
2. Look up the normalised barcode in `foods`: your own foods, then the shared catalogue. Hit → amount sheet.
3. Miss → server route queries Open Food Facts → save to `foods` → amount sheet.
4. Still a miss, or no energy value → straight into the label photo flow, carrying the barcode along.

Vibrate briefly on a successful read. Rescanning a product you already have never calls Open Food Facts again.

### 3. Label photo

For products no database has, products with no barcode or one that won't scan, and to fill missing nutrients. Three ways in: a barcode miss (automatic), the "No barcode?" link on the Scanner, and the Label position of the camera's Meal / Label switch.

1. By the time this flow opens, the barcode flow has already checked the shared catalogue, so a label is only ever read once across all users. Photograph the nutrition information panel (optionally a second photo of the front, for the name).
2. Server route sends it to the user's AI provider, which returns per-100 g values for the nine nutrients, serving size, pack size and product name as structured JSON. Australian panels show per-serve and per-100 g columns: take per-100 g; if only per-serve is legible, divide by the serving size and flag it.
3. Show the extracted values in an editable form beside the photo for a quick check. Anything the model couldn't read is blank, not guessed.
4. Confirm → saved to the **shared catalogue** (with the barcode if there was one, the photo, and who added it) → amount sheet. Without an AI key, step 2 is skipped and the form opens empty for typing the values from the label; the result is shared just the same.

### 4. Meal photo

1. Take a photo with the camera's switch on Meal (Label goes to flow 3). Before sending, an optional one-line hint box ("chicken stir-fry, 1 tbsp oil"); hints improve accuracy more than anything else, so make it easy to dictate into.
2. Server route: the user's AI provider lists each visible item with an estimated gram weight of what's actually on the plate, plus a confidence level. It also lists likely hidden fats (cooking oil, butter, dressing) as separate *suggested* items.
3. Server matches each item name to `foods` via the same search, keeping the top three candidates.
4. **Meal confirm screen:** one row per item showing the matched food (tap to swap for another candidate or search), a gram field (tap opens the amount sheet), and a remove button. Suggested hidden fats appear unticked with sensible amounts from AUSNUT measures (for example, 1 tsp oil). Running totals at the bottom. Save logs every row as its own entry, linked to the photo. A **Save as meal** button also stores the rows as a meal (see below) for next time.
5. The photo and the AI response are stored with the entries, so nothing is ever re-sent to AI.

### 5. Typed or dictated text

A single box: "45 g salad, 2 eggs, flat white, 30 g almonds". It works with Gboard voice typing as-is.

- If every item has an explicit amount and an obvious match, parse it locally.
- Otherwise the server sends it to Gemini, which returns items with grams. Counts ("2 eggs") convert using AUSNUT measures, not model guesses.
- Result goes to the meal confirm screen, same as a photo.

### 6. Meals (composite foods)

A meal is a named recipe: a list of ingredient foods with grams, and a total weight. The example to build against: a pasta with six ingredients, of which Daniel eats 300 g.

- **Create** from the Meals tab (add ingredients by search or barcode, type grams for each), from the meal confirm screen ("Save as meal"), or from any logged meal on the Today screen ("Save these as a meal").
- **Total weight** defaults to the sum of the ingredients. For cooked dishes, type the cooked weight off the scales instead (pasta takes on water, a sauce reduces); the per-100 g profile is worked out from that total.
- **Serves** are optional ("makes 4") and give a one-serve chip.
- **Logging a meal is exactly like logging a food:** tap it, type the grams eaten, Save. Chips: last amount, one serve, half, whole meal. The entry stores the meal's per-100 g snapshot, so changing the recipe later never alters past days.
- **Variations:** on the amount sheet, "Adjust ingredients" opens today's copy of the recipe to drop or change an item for this log only (no cheese today). From there, "Save as new meal" if it's a keeper.
- **Easy to reach:** meals sit at the top of Search, appear in Recent and Frequent like any food, and have a Meals tab of their own sorted by most recent use. The widget's Search button lands on this list.
- A meal containing a food with a missing nutrient inherits the gap: "–" for that nutrient and incomplete day totals.
- **Copy a day's meal** (yesterday's lunch to today) stays available on every meal group, separate from saved meals.

## Screens

Mobile-first, one hand, calm and muted. No streaks, badges, motivational copy or notifications of any kind.

| Screen | What's on it |
| --- | --- |
| **Onboarding** | Profile, weight goal (showing the resulting daily target and any warning, with Continue anyway), then the AI key step with the three providers side by side, which can be skipped. |
| **Today** (home) | Progress ring with the mini-map marker. Nutrient rows with their targets (sodium shows salt in brackets). A quick weigh-in button. Entries grouped by meal: name, grams, kcal; each group has Copy and "Save these as a meal". A fixed bar of four log buttons: Scan, Photo, Search, Type. Swipe left and right to move between days. |
| **Search** | Search box (accepts "45 salad"), then your Meals, Recent and Frequent lists with last amounts. |
| **Meals** | Your meals by most recent use, each with its total weight and per-100 g energy. Tap to log (amount sheet); edit and duplicate from the row; New meal button. |
| **Meal editor** | Name; ingredient rows (food, grams) added by search or barcode; total weight (sum of ingredients, or typed cooked weight); serves; live per-100 g and per-serve nutrients. |
| **Scanner** | Full-screen camera with a framing box, "Type barcode" link, "No barcode? Photograph the label" link, torch toggle if the device supports it. |
| **Amount sheet** | As specified in "Entering amounts". For a meal, adds "Adjust ingredients". |
| **Meal confirm** | As specified in the meal photo flow. Used by photo and text; has Save as meal. |
| **Label review** | Photo on top (if any), editable per-100 g values below, name, serve and pack size, Confirm. Also the manual-entry form when there's no AI key. |
| **Food detail** | Per-100 g values with source, who added it and when, measures list (add your own: "my bowl · 320 g"), edit, "Fill gaps from label photo". Edits create your own copy; the shared row stays untouched. |
| **Goal** | Weight trend chart with start, current and goal weight and the on-pace line. Edit goal and profile; see how the daily target was calculated; any warning you've dismissed is listed here. |
| **Trends** | 7- and 30-day daily averages per nutrient against targets. A plain table is fine for v1. |
| **Settings** | Nutrient targets with direction, energy target override, warning thresholds, kJ or kcal, meal time boundaries, widget nutrients, AI key (three providers as equals), Health Connect status and resync, About with data credits. |
| **Admin** (Daniel only) | Invite by email, list of users, revoke access. |

Every screen must work in portrait at a typical phone width (about 412 px) without horizontal scroll, and in both system light and dark themes.

## Data model

A sketch, not final DDL. Claude Code should refine types, indexes and constraints, and enable row-level security on every user-owned table.

```sql
-- People. One row per invited user.
profiles (
  user_id uuid pk references auth.users,
  display_name text, is_admin boolean default false,
  birth_date date, sex text check (sex in ('female','male')),
  height_cm numeric, activity_level text check (activity_level in ('sitting','some','active','very_active')),
  energy_target_override_kcal numeric null,   -- manual target wins if set
  warn_rate_pct_per_week numeric default 1, warn_floor_kcal numeric null,  -- null = the sex-based default
  time_zone text, energy_unit text default 'kcal', meal_boundaries jsonb, widget_nutrients text[],
  created_at timestamptz
)

goals (id, owner_id, start_weight_kg, start_date, target_weight_kg, target_date, active boolean,
       warnings_dismissed text[])            -- which warnings the person chose to continue past
weigh_ins (id, owner_id, measured_at timestamptz, weight_kg numeric, source text default 'manual')

-- Calories burned per local day, read from Health Connect by the wrapper.
daily_burn (owner_id, date, total_kcal numeric, active_kcal numeric null, source_app text, fetched_at timestamptz)

-- Absent row = no target. min = at least, max = no more than, range = both.
nutrient_targets (owner_id, nutrient text, direction text check (direction in ('min','max','range')),
                  low numeric null, high numeric null)

-- Each user's own AI key. Never selectable by the browser; server routes only.
ai_keys (owner_id pk, provider text check (provider in ('anthropic','gemini','deepseek')),
         key_encrypted bytea, key_last4 text, model text null, verified_at timestamptz)

-- One row per food OR meal from any source. Nutrients are per 100 g; null = unknown.
foods (
  id uuid pk,
  source text check (source in ('user','label','meal','fsanz_branded','off','ausnut','afcd')),
  source_id text,                -- FSANZ key, OFF code, etc.; unique with source
  visibility text check (visibility in ('shared','private')),  -- 'label' rows are always shared
  created_by uuid null,          -- who added a label-read, custom food or meal
  barcode text null,             -- normalised GTIN
  name text, display_name text, brand text null,
  energy_kj numeric null, protein_g numeric null, fat_g numeric null,
  sat_fat_g numeric null, trans_fat_g numeric null, carbs_g numeric null,
  sugars_g numeric null, fibre_g numeric null, sodium_mg numeric null,
  extra_nutrients jsonb,         -- everything else FSANZ provides
  serving_g numeric null, pack_g numeric null,
  total_weight_g numeric null, serves numeric null,   -- meals only
  is_liquid boolean default false, density_g_per_ml numeric null,
  missing_nutrients text[],      -- computed on write (for meals: union of ingredients')
  derived_from_food_id uuid null,-- a private edited copy of another food
  raw jsonb,                     -- original source payload
  search tsvector,               -- name + brand + common names
  fetched_at timestamptz, created_at timestamptz
)

-- A meal's recipe. Per-100 g values on the meal row are recomputed whenever this changes.
meal_ingredients (meal_food_id references foods, ingredient_food_id references foods,
                  grams numeric, position int)

-- Household measures: AUSNUT measures, pack serves, your own ("my bowl").
food_measures (id, food_id, label text, grams numeric, source text, owner_id null)

-- What you ate. Nutrient values are a snapshot at log time.
log_entries (
  id uuid pk, owner_id uuid,
  eaten_at timestamptz, meal text check (meal in ('breakfast','lunch','dinner','snack')),
  food_id uuid, food_name_snapshot text,
  grams numeric, entered_amount numeric, entered_unit text check (entered_unit in ('g','ml')),
  per100_snapshot jsonb,         -- the nine nutrients per 100 g at log time
  ingredient_adjustments jsonb null,  -- a meal logged with changed ingredients, this log only
  is_estimate boolean,           -- photo-estimated grams or assumed density
  method text check (method in ('search','barcode','label','photo','text','meal','repeat')),
  meal_photo_id uuid null,
  hc_synced_at timestamptz null,
  created_at, updated_at
)

meal_photos (id, owner_id, storage_path, hint text, provider text, model text, ai_response jsonb, created_at)
label_photos (id, owner_id, food_id, storage_path, provider text, model text, ai_response jsonb, created_at)

-- Per person. Drives Recent/Frequent lists and the "last amount" chip over the shared catalogue.
user_food_stats (owner_id, food_id, use_count int, last_used_at, last_grams, last_unit)
```

- Day totals are computed from `log_entries` (a SQL view or function by local date). Group days in each user's own time zone (store it on the profile from the device; Daniel's is Australia/Sydney), not UTC.
- Photos go in a private Supabase Storage bucket. Downscale to about 1,024 px on the longest side before upload.

## Android wrapper

Same idea as the Elevate wrapper: a thin Android app hosting the web app, plus a home-screen widget. This one needs a **WebView with a JavaScript bridge**, because Health Connect and the widget are fed from the web app. If Elevate's wrapper turns out to be a Trusted Web Activity, don't copy that part; use a WebView here.

### Camera inside the WebView

- Request the `CAMERA` permission, and grant video capture in `WebChromeClient.onPermissionRequest` so the live camera works for barcode scanning.
- Handle `onShowFileChooser` so photo capture (`<input type="file" accept="image/*" capture="environment">`) opens the camera.
- Check `BarcodeDetector` is available inside the WebView on the Pixel. It depends on Google Play Services, which a Pixel has. If it isn't, fall back to a JavaScript barcode library rather than native scanning.

### The bridge

Expose `window.FoodBridge` only inside the wrapper; the web app must work normally in a browser without it.

| Method | Called when | Native side does |
| --- | --- | --- |
| `syncEntries(json)` | After any save or edit | Upserts one Health Connect nutrition record per entry, then calls back with the IDs that succeeded so the web app sets `hc_synced_at` |
| `deleteEntries(ids)` | After a delete | Deletes those records from Health Connect |
| `readBurn(days)` | On app open, and when the Goal screen opens | Reads total and active calories burned per day for the last `days` days from Health Connect and returns them; the web app stores them in `daily_burn` |
| `updateWidget(json)` | After any change, and on app open | Stores today's summary locally and refreshes the widget |
| `healthConnectStatus()` | Settings screen | Returns installed, which permissions are granted, last sync time |

### Health Connect

- Permissions: write nutrition; read total calories burned and active calories burned. Ask for the read permissions in a second step, with one line saying what they're for, so a friend without a watch can decline.
- **Writing:** one `NutritionRecord` per log entry: start time = `eaten_at`, end time = one minute later, meal type mapped from `meal`, name = food name, all nine nutrients scaled to the grams eaten. Leave unknown nutrients unset, never zero.
- Use the log entry's ID as the client record ID, and its `updated_at` as the client record version, so re-sending is safe and edits overwrite cleanly.
- **Reading burn:** aggregate `TotalCaloriesBurned` and `ActiveCaloriesBurned` per local day. Where several apps write burn for the same day (Garmin Connect and a phone pedometer, say), prefer the source the user picks in Settings, defaulting to the one with the highest daily total, and never add sources together.
- Settings has "Resync today" (re-sends all of today's entries) and "Refresh burn".

### Widget

Built with Jetpack Glance, as in Unvice.

- A small version of today's progress ring, plus three nutrients chosen in Settings (default: protein, saturated fat, sodium).
- Four buttons: Scan, Photo, Search, Type. Each opens the wrapper straight to that route (`/log/scan`, `/log/photo`, `/log/search`, `/log/type`).
- Reads the summary stored by `updateWidget`. If the stored date isn't today in Sydney time, show "Nothing logged yet today" instead of yesterday's numbers. Schedule a refresh just after midnight.
- Muted styling to match the phone's quiet home screen.

## Server routes, AI and setup

### Routes (Vercel)

| Route | Does |
| --- | --- |
| `GET /api/barcode/[code]` | Normalise; check the user's own foods, then the shared catalogue, then Open Food Facts (store the result); return the food or `{ miss: true }` |
| `POST /api/label` | Photo in Storage → the user's own AI provider → draft per-100 g values. Saves nothing until the user confirms; on confirm the food is written to the shared catalogue with the photo and who added it |
| `POST /api/meal-photo` | Photo + optional hint → the user's own AI provider → items with grams → matched to `foods` → draft meal |
| `POST /api/parse-text` | Text → local parse, or the user's own AI provider if needed → draft meal |
| `POST /api/ai-key` · `DELETE /api/ai-key` | Test, encrypt and save the user's key (returns only provider, model, last four characters); or delete it |
| `POST /api/admin/invite` · `DELETE /api/admin/users/[id]` | Admin only: send a Supabase invite; revoke a user |

Search, logging, saved meals and settings go straight from the browser to Supabase under row-level security. Search is a Postgres function (`search_foods(query)`) that applies the ranking rules.

### AI calls

- Every AI call uses the signed-in user's own key and provider, decrypted only inside the route for that request. There is no app-wide AI key.
- One adapter each for Claude, Gemini and DeepSeek, sharing the same prompts and JSON schemas, so results look identical whichever key someone uses. Model names per provider live in config. DeepSeek currently takes images through a separate model name that it labels experimental; use it and keep it in config like the others.
- Structured JSON output with a schema, low temperature (about 0.1), and validate the result. On a failure, retry once, then show a clear error with a Retry button. Provider errors such as an invalid key or quota exceeded get their own plain message pointing to Settings.
- **Never call AI for something already known:** a label whose barcode is in the catalogue, or a photo or text that has already been processed. Stored responses are reused.
- **One pass only.** Don't add a "check your answer" second call; research found it made estimates worse.
- AI never returns nutrient values for meals or text, only foods and grams.

**Meal photo prompt must say:**

- List each distinct visible food. Estimate the grams of the portion **actually visible on the plate**, not a standard serving size.
- Treat the user's hint as true where it conflicts with the photo.
- List likely hidden fats (cooking oil, butter, dressing) as separate items marked as suggestions.
- Name each item in plain generic terms that would match an Australian food database ("rice, white, cooked"), plus a short display name.
- Give each item a confidence: low, medium or high. Return no calories or nutrients.

**Label photo prompt must say:**

- Read the nutrition information panel. Return the per-100 g column exactly as printed, energy in kJ and sodium in mg.
- If a value is missing or unreadable, return null. **Never estimate a number.**
- Also return serving size (g or ml), servings per pack, product name and brand if visible, and a flag if per-100 g values had to be derived from the per-serve column.

**Text parse prompt must say:**

- Split the text into foods with amounts. Return grams or ml when given; for counts ("2 eggs"), return the count and the noun so the server converts using AUSNUT measures. Return no nutrients.

### Repo layout and environment

```text
/app            Next.js (App Router, TypeScript)
/android        Wrapper and Glance widget (Kotlin)
/supabase       Migrations, SQL functions, RLS policies
/scripts        FSANZ importers and other source adapters
/data/raw       Downloaded FSANZ files (git-ignored)
```

Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server and scripts only: imports, invites, key storage), `KEY_ENCRYPTION_SECRET` (unless Supabase Vault is used), `ADMIN_EMAIL`, `OFF_BASE_URL` (staging during development), `OFF_USER_AGENT`. No AI keys in the environment.

## Build order and acceptance checks

Design first, then build in four stages, each usable on its own. Don't start a stage until the previous one passes its checks.

0. **Design (Claude Design, before any code):** a few distinct concept directions shown on the same key screens; Daniel picks one; then the full screen set in that direction, light and dark, plus the widget, the progress ring and mini-map, macro colours, type and spacing tokens. Claude Code starts only once these are approved.
1. **Foundations (web only):** Supabase schema, invites and admin, onboarding (profile, goal, warnings), FSANZ import scripts, search, amount sheet, Today screen with the ring, nutrient targets, weigh-ins, Goal screen, copy-a-meal.
2. **Packaged food and meals:** barcode scanner, Open Food Facts lookup and caching, label review with manual entry into the shared catalogue, food detail, meals and the meal editor.
3. **AI logging:** bring-your-own key with the three provider adapters, label reading, meal photo, typed text, meal confirm screen, Save as meal.
4. **Android:** WebView wrapper, camera permissions, bridge, Health Connect, Glance widget.

**Phase 2, after a few weeks of real use:** weigh before and after, a target that adapts from logged intake and weight trend, weigh-ins read from Health Connect, bulk import of Australian Open Food Facts products for name search, the FSANZ Branded Food Database adapter once FSANZ publishes the files, trend charts, extra nutrients.

### Acceptance checks

- [ ] **The core fix:** with a salad logged before, logging 45 g takes: Search, tap the salad, type 45, Save. No unit change at any point.
- [ ] Typing "45 salad" in search opens the chosen salad with 45 g already filled in.
- [ ] Log three foods by hand; every day total matches a manual calculation (to 1 kJ, 0.1 g, 1 mg).
- [ ] Sodium shows the salt equivalent beside it.
- [ ] An Open Food Facts product with no saturated fat shows "–", the day's saturated fat total shows as incomplete, and its Health Connect record leaves saturated fat unset.
- [ ] Scanning the same barcode twice makes only one Open Food Facts request.
- [ ] **Shared catalogue:** after one user confirms a label photo, a second user scanning the same barcode gets that food with no AI call and no Open Food Facts call.
- [ ] A label photo of a real Australian panel returns all nine per-100 g values exactly as printed; anything unreadable is blank.
- [ ] A meal photo returns items with grams and no nutrient numbers from the AI; hidden-fat suggestions start unticked.
- [ ] **Meals:** a six-ingredient pasta with a typed cooked weight of 1,200 g; logging 300 g gives exactly a quarter of the recipe's nutrients. Changing the recipe afterwards doesn't change that entry. "Adjust ingredients" with the cheese removed changes only today's entry.
- [ ] **Providers:** the key screen shows Claude, Gemini and DeepSeek in the same layout with nothing pre-selected. The same label photo sent through each provider lands in the same review form.
- [ ] An entry logged at 11:30 pm local time stays on that day.
- [ ] **Invites:** a friend invited by email can join and sees only their own log; signing up without an invite fails.
- [ ] **AI keys:** a saved key never appears in any response sent to the browser. With no key, Photo and Type show "Add an AI key to use this" and manual label entry still works.
- [ ] **Energy target:** for a sample profile with no burn data, the target matches a hand calculation from the formula. With 410 kcal of active burn in Health Connect, the target rises by 410 and the ring shows that part of the track separately. A day with burn from two apps is never summed.
- [ ] **Guardrails:** a goal faster than 1% a week shows the warning and Continue anyway works; a target below the floor shows the warning and Continue anyway works; a date in the past, or a goal that would need a negative target, is refused with the earliest reachable date shown.
- [ ] **Ring:** the protein, carbohydrate, fat and other segments add up exactly to energy logged; going over target shows a second lap.
- [ ] **Nutrient targets:** with protein at least 150 g, the bar ticks at 150 g; with saturated fat no more than 7 g, it turns amber at 6.3 g and shows the warning tone above 7 g.
- [ ] Log, edit and delete an entry: the Health Connect record appears, updates and disappears, and "Resync today" creates no duplicates.
- [ ] The widget updates within a few seconds of logging, and after midnight shows "Nothing logged yet today".
- [ ] The web app works in plain Chrome on a laptop with no bridge and no console errors.

## Decisions to confirm before building

Defaults are set so Claude Code can start; change any of these here first.

| Decision | Default in this brief |
| --- | --- |
| App name and Android package name | "Calorie Counter" as a working title; needs a real name before Design starts |
| Energy shown as | kcal, with kJ in Settings (Australian labels use kJ) |
| What the "mini-map" shows | Progress toward the weight goal (start, now, goal, on-pace tick). Design to show options |
| AI providers | Claude, Gemini and DeepSeek, shown as equals, no default |
| Warnings (dismissable, thresholds editable) | Faster than 1% of body weight a week; below 1,200 kcal (females) or 1,500 kcal (males) |
| Hard stops | Only a target date in the past, or a goal that would need a negative calorie target. No hard cap on rate of change |
| Label-read foods | Shared with all users, with or without a barcode |
| Duplicate products without a barcode | Tolerated in v1; merge tool in phase 2 |
| Meal total weight | Sum of ingredients unless a cooked weight is typed |
| Maintenance calories | Resting energy + today's measured activity burn + goal adjustment; activity estimated from the activity level when there's no burn data |
| Today's burn changes today's target | On, with the activity part shown on the ring; a Stable mode toggle in Settings uses the 7-day average instead |
| Nutrients on the widget | Protein, saturated fat, sodium |
| Daily nutrient targets | None preset; each person sets their own |
| Send label photos back to Open Food Facts | Off. Turning it on needs an Open Food Facts account, and the photos become public |
