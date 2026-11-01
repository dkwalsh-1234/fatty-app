-- Settings > Energy > Count estimated activity (1 Nov). On (the default): until Health Connect has
-- today's burn, the target adds an estimate from your activity level. Off: only logged burn counts.
alter table public.profiles add column if not exists estimate_activity boolean not null default true;
