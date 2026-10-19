import "server-only";

// The barcode lookup order: your own foods, the shared label catalogue, FSANZ Branded (once
// published), then Open Food Facts (stored on first scan, never called twice for the same product).

import type { SupabaseClient } from "@supabase/supabase-js";
import { offBaseUrl, offUserAgent } from "./server-env";
import { offAdapter } from "./sources/off";
import { admin } from "./supabase/admin";

const OFF_LIMIT_PER_MINUTE = 15;
/** A product Open Food Facts didn't have is asked about again only after this long. */
const MISS_TTL_DAYS = 14;

export type BarcodeAnswer =
  | { food: Record<string, unknown>; from: "mine" | "catalogue" | "off" }
  | { miss: true; reason: "not_found" | "no_energy" }
  | { error: string; status: number };

export async function lookupBarcode(sb: SupabaseClient, userId: string, barcode: string): Promise<BarcodeAnswer> {
  // 1. Your own foods (edited copies, custom foods).
  const { data: mine } = await sb
    .from("foods")
    .select("*")
    .eq("barcode", barcode)
    .eq("visibility", "private")
    .eq("created_by", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (mine?.[0]) return { food: mine[0], from: "mine" };

  // 2-4. The shared catalogue: label-read foods, then FSANZ Branded, then cached Open Food Facts rows.
  const { data: shared } = await sb.from("foods").select("*").eq("barcode", barcode).eq("visibility", "shared");
  const rank = (s: string) => (s === "label" ? 0 : s === "fsanz_branded" ? 1 : s === "off" ? 2 : 3);
  const best = (shared ?? []).filter((f) => f.energy_kj != null).sort((a, b) => rank(a.source) - rank(b.source))[0];
  if (best) return { food: best, from: "catalogue" };

  const svc = admin();
  // Don't ask Open Food Facts again about a product it recently didn't have.
  const since = new Date(Date.now() - MISS_TTL_DAYS * 86_400_000).toISOString();
  const { data: recentMiss } = await svc
    .from("off_lookups")
    .select("status")
    .eq("barcode", barcode)
    .in("status", ["miss", "no_energy"])
    .gte("at", since)
    .order("at", { ascending: false })
    .limit(1);
  if (recentMiss?.[0]) return { miss: true, reason: recentMiss[0].status === "no_energy" ? "no_energy" : "not_found" };

  // All users share one server address, so one limit: 15 product lookups a minute.
  const { count } = await svc
    .from("off_lookups")
    .select("id", { count: "exact", head: true })
    .gte("at", new Date(Date.now() - 60_000).toISOString())
    .neq("status", "rate_limited");
  if ((count ?? 0) >= OFF_LIMIT_PER_MINUTE) {
    await svc.from("off_lookups").insert({ barcode, status: "rate_limited" });
    return { error: "Lots of scanning right now. Try again in a minute, or photograph the label.", status: 429 };
  }

  const result = await offAdapter({ baseUrl: offBaseUrl(), userAgent: offUserAgent() }).lookup(barcode);
  await svc.from("off_lookups").insert({ barcode, status: result.status });
  if (result.status === "hit") {
    const { data: inserted, error } = await svc.from("foods").insert(result.food).select("*").single();
    if (!error && inserted) return { food: inserted, from: "off" };
    // Someone else's scan beat us to it: show the row that's there.
    const { data: existing } = await svc.from("foods").select("*").eq("source", "off").eq("source_id", barcode).maybeSingle();
    if (existing) return { food: existing, from: "off" };
    return { error: "Couldn't save that product. Try again.", status: 500 };
  }
  if (result.status === "no_energy") return { miss: true, reason: "no_energy" };
  if (result.status === "miss") return { miss: true, reason: "not_found" };
  return { error: "message" in result ? result.message : "Open Food Facts lookup failed.", status: result.status === "rate_limited" ? 429 : 502 };
}
