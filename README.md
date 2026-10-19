# Fatty

An invite-only food logger for the full Australian nutrition panel: barcode scan, meal photo, label photo, search and typed entry. Next.js on Vercel with Supabase, wrapped for Android with a home-screen widget and Health Connect sync. Built to `docs/build-brief.md` and the approved design (direction B, "Halo") in `docs/design/`.

The one thing it does better than MyFitnessPal: choosing a food opens an amount field already in grams with the keypad up. Typing 45 and tapping Save is the whole job.

## Layout

```text
app/            Next.js App Router (pages, API routes)
components/     UI kit (components/ui), app pieces (components/app), forms, Today
design/         Design pack: tokens (tokens.json → node design/tokens/build.mjs) and ring / target bar
lib/            Pure logic (nutrients, target, dates, parse, amount, day), data access, AI layer, sources
supabase/       Migrations (schema, RLS, SQL functions, storage buckets)
scripts/        FSANZ importers (AUSNUT 2023, AFCD Release 3) and the Vercel deploy script
data/raw/       FSANZ downloads (git-ignored; see data/raw/README.md)
android/        WebView wrapper, JS bridge, Health Connect, Glance widget (see android/README.md)
docs/           Brief, design handoff, Android bridge contract
tests/          Vitest: logic, AI adapters (mocked), migrations on PGlite, importers
```

## Set up

1. **Supabase project.** Create one, ideally in Sydney (ap-southeast-2), then run `supabase/migrations/*.sql` in the SQL editor, oldest first (or `supabase link` and `supabase db push`). The migration creates every table with row-level security, the `search_foods`, `day_entries` and `daily_totals` functions, and the private `meal-photos` and `label-photos` buckets.
2. **Auth settings** (Authentication in the dashboard):
   - Turn **off** "Allow new users to sign up". Invites still work: they use the service key.
   - Site URL: your Vercel address. Redirect URLs: `https://<app>/auth/accept`, `https://<app>/auth/confirm`, and `http://localhost:3000/**` for development.
   - The default invite email works as it is (it lands on `/auth/accept`, which reads the session from the link). Optional: change the "Invite user" template's link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/welcome`.
3. **Environment.** Copy `.env.example` to `.env.local` and fill it in. Generate `KEY_ENCRYPTION_SECRET` with `openssl rand -base64 32`; changing it later makes saved AI keys unreadable (people add them again). Set `ADMIN_EMAIL` to Daniel's address. Use the Open Food Facts staging server (`https://world.openfoodfacts.net`) during development and `https://world.openfoodfacts.org` in production. Set the same variables in Vercel.
4. **Food data.** Download the FSANZ files into `data/raw/` (FSANZ asks you to accept a licence), then follow `data/raw/README.md`: `npm run import:ausnut -- --print-headers`, then `--dry-run`, then the real run; the same for `import:afcd`. Re-running after a new release updates rather than duplicates.
5. **Run it.** `npm install`, `npm run dev`, open http://localhost:3000. Daniel signs in first: create his user in Supabase (Authentication, Add user) with the `ADMIN_EMAIL` address, then use **Admin** in the app to invite friends.
6. **Deploy.** `npx vercel link` once, then `npm run deploy` (copies the project without git history, as Keep does). `vercel.json` pins the Sydney region; keep it next to the database.
7. **Android.** See `android/README.md`: put the Vercel address in `android/fatty.properties`, build, install with `adb`.

Checks: `npm test` (Vitest, including the migrations on PGlite), `npm run typecheck`, `npm run lint`, `npm run build`.

**Preview without a database:** `npm run dev`, then http://localhost:3000/dev?screen=today (also `&d=2026-10-18`, `sheet`, `sheet-ml`, `sheet-meal`, `goal`, `settings`, `aikey`). It runs the real screens on the design's sample day and returns 404 in production. It needs `NEXT_PUBLIC_SUPABASE_URL` and a key set (any values) so the server starts, but never calls Supabase.

## How it works

- **Nutrients only from data.** AI identifies foods, estimates grams, reads label numbers or splits typed text; values per 100 g always come from a food row or a label someone confirmed. Missing values are `null`, shown as "–", and day totals say "incomplete · n".
- **Shared catalogue.** Every food created from a label goes into the shared catalogue with its photo and who added it. Barcode lookups go: your foods, the shared catalogue, FSANZ Branded (adapter ready for when FSANZ publishes it), then Open Food Facts, stored on first scan. Misses are remembered for 14 days and all users share the 15-a-minute Open Food Facts limit. A label is checked against the catalogue by barcode before any AI call.
- **AI keys.** Each person brings their own key for Claude, DeepSeek or Gemini, offered as equals. Keys are sealed with AES-256-GCM using `KEY_ENCRYPTION_SECRET`, stored where the browser can't select them, decrypted only inside server routes, and shown back only as the last four characters. Model names and data-use notes live in `lib/ai/config.ts`.
- **Energy target.** Mifflin-St Jeor resting energy, plus activity measured from Health Connect (or estimated from the activity level, marked "est."), plus the goal adjustment, rounded to 10. Guardrails warn and let you continue; only a past date or a goal needing a negative target is refused, with the earliest reachable date.
- **Snapshots.** Each log entry keeps the per-100 g values it was logged with, so editing a food or meal never rewrites history. Days are grouped in each person's own time zone.

## Decisions taken while building

These follow the brief and the design handoff's "Open decisions"; change any of them if you'd rather.

- **Model names (checked 19 Oct 2026).** Claude `claude-haiku-5-5`, Gemini `gemini-3.8-flash`, DeepSeek `deepseek-flash`. The brief expected DeepSeek's experimental vision model; DeepSeek has since retired `deepseek-v4-flash-vision-exp` and serves images from `deepseek-flash`.
- **Temperature.** Gemini and DeepSeek run at 0.1. Claude Haiku 5.5 rejects any non-default temperature, so it runs at its default with low effort.
- **Near-limit tone** is the soft warning colour at 90% (the design's choice), not amber, which would read as carbohydrate. "Above a range" is a warning-text caption without hatching.
- **A fat named in the hint** ("1 tbsp oil") becomes a found item at that amount; only unnamed hidden fats are unticked suggestions.
- **No "100 g" chip** on the amount sheet (not in the brief's chip list).
- **Grams view of the ring** (tap the ring): protein, carbs and fat in grams and share of energy, as the handoff suggests.
- **Mini-map** is the inner halo (start, now, on-pace, goal); the goal line under the ring opens the Goal screen.
- **Switching g to ml** keeps the number you typed.
- **Revoke** blocks sign-in and keeps the person's data (Restore undoes it); a pending invite is withdrawn outright.
- **"Fill gaps from label photo"** fills only missing values on the shared food, for everyone; it never overwrites a value.
- **Copy a meal:** each meal group's menu copies the previous day's same meal here, or (on a past day) copies that group to today.

## Not verified yet

Everything except live services was checked: 100+ tests, type check, lint, a production build, and the main screens in a browser against the design PNGs in light and dark at 360 and 412 px. These need the real backend or a phone:

- Sign-in, invites, RLS and storage against a real Supabase project (the migrations and RLS are tested on PGlite).
- Real AI calls with each provider's key (adapters are tested with mocked HTTP), and a real Australian label read end to end.
- Open Food Facts lookups (staging returns 404 for most Australian barcodes).
- The FSANZ importers on the real files (tested on generated files built from FSANZ's documented headers).
- Everything in `android/README.md`'s "Verify on the Pixel" list: camera and BarcodeDetector in the WebView, Health Connect records and burn, the widget and its midnight refresh.
