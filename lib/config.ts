// Public configuration, safe to use on the client. NEXT_PUBLIC_* values must
// be referenced literally so Next can inline them into the browser bundle.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Supabase now calls the anon key the "publishable" key; accept either name.
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "";

export const MEAL_PHOTO_BUCKET = "meal-photos";
export const LABEL_PHOTO_BUCKET = "label-photos";

/** Photos are downscaled to this on the longest side before upload. */
export const PHOTO_MAX_PX = 1024;
