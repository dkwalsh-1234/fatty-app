// Service-role Supabase client for the import scripts. Reads NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) from the environment, loading .env.local first.
// The service role bypasses row-level security, which is what lets the importers write shared foods.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Minimal KEY=value parser for Node versions without process.loadEnvFile. Never overrides existing variables. */
function parseEnvFile(path: string) {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = (m[2] ?? '').trim();
    const quoted = v.match(/^(['"`])([\s\S]*)\1$/);
    if (quoted) v = quoted[2];
    else v = v.replace(/\s+#.*$/, '');
    process.env[m[1]] = v;
  }
}

/** Loads .env.local, then .env, from the current directory. Variables already set win. */
export function loadEnv(files: string[] = ['.env.local', '.env']) {
  for (const f of files) {
    const path = resolve(process.cwd(), f);
    if (!existsSync(path)) continue;
    if (typeof process.loadEnvFile === 'function') {
      try {
        process.loadEnvFile(path);
        continue;
      } catch {
        // Fall through to the simple parser.
      }
    }
    parseEnvFile(path);
  }
}

export function createAdminClient(): SupabaseClient {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !key && 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(' and ')}. Set them in .env.local (or the environment) and run again.`);
  }
  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
