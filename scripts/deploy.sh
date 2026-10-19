#!/usr/bin/env bash
# Deploys the web app to Vercel (production) from a clean copy with no git history, as Keep does:
# the Reforest team on Vercel blocks deployments whose git commit author isn't a team member.
# Needs `npx vercel link` to have been run once (it writes .vercel/project.json).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .vercel/project.json ] || { echo "Run 'npx vercel link' first." >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Top-level entries in .vercelignore start with "/", which rsync also treats as anchored.
rsync -a --exclude-from=<(grep '^/' .vercelignore) --exclude /.git ./ "$tmp/"
mkdir -p "$tmp/.vercel" && cp .vercel/project.json "$tmp/.vercel/"

cd "$tmp"
npx vercel deploy --prod --yes --archive=tgz "$@"
