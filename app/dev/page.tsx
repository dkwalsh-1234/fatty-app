import { notFound } from "next/navigation";
import { DevPreview } from "./DevPreview";

// Development-only preview of real screens on sample data, for checking them against the designs
// without a database. Returns 404 in production.
export default function DevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevPreview />;
}
