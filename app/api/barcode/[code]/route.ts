import { bad, json, routeUser } from "@/lib/api";
import { normalizeBarcode } from "@/lib/barcode";
import { lookupBarcode } from "@/lib/catalogue";

// Normalise; check your own foods, then the shared catalogue, then Open Food Facts (stored).
// Returns the food, or { miss: true } so the app goes straight to the label photo flow.
export async function GET(req: Request, ctx: RouteContext<"/api/barcode/[code]">) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const { code } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? undefined;
  const barcode = normalizeBarcode(code, format);
  if (!barcode) return bad("That doesn't look like a product barcode.");
  const r = await lookupBarcode(auth.sb, auth.user.id, barcode);
  if ("error" in r) return bad(r.error, r.status);
  return json({ barcode, ...r });
}
