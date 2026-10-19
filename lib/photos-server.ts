import "server-only";
import type { AiImage } from "./ai/adapters";
import { admin } from "./supabase/admin";

/** Downloads a photo the person uploaded (their own folder only) as base64 for the AI call. */
export async function photoForAi(bucket: string, path: string, userId: string): Promise<AiImage> {
  if (!path || path.split("/")[0] !== userId || path.includes("..")) throw new Error("That photo isn't yours.");
  const { data, error } = await admin().storage.from(bucket).download(path);
  if (error || !data) throw new Error("Couldn't find that photo. Take it again.");
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = data.type === "image/png" || data.type === "image/webp" ? data.type : "image/jpeg";
  return { mime, base64: buf.toString("base64") };
}
