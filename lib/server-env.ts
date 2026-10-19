import "server-only";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function serviceKey(): string {
  return required(
    "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
  );
}

export function keyEncryptionSecret(): string {
  const s = required("KEY_ENCRYPTION_SECRET", process.env.KEY_ENCRYPTION_SECRET);
  if (s.length < 32) throw new Error("KEY_ENCRYPTION_SECRET must be at least 32 characters");
  return s;
}

export const adminEmail = () => (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

export const offBaseUrl = () => (process.env.OFF_BASE_URL ?? "https://world.openfoodfacts.net").replace(/\/$/, "");
export const offUserAgent = () => process.env.OFF_USER_AGENT ?? "Fatty/0.1";
