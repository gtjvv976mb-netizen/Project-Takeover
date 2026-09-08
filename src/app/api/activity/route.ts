import { db } from "@/lib/db";
import { json } from "@/lib/api-utils";
export const dynamic = "force-dynamic";
/** Recent market events for the pulse ticker. */
export async function GET() {
  const rows = db().prepare(`SELECT e.kind, e.created_at, l.id, l.title, l.price_lamports, l.type FROM events e JOIN listings l ON l.id = e.listing_id
    WHERE e.kind IN ('escrowed','created','paid','settled','released') AND l.status != 'draft' ORDER BY e.id DESC LIMIT 20`).all() as Record<string, string | number>[];
  return json(rows.map((r) => ({ kind: r.kind, at: Number(r.created_at), id: r.id, title: r.title, priceLamports: Number(r.price_lamports), type: r.type })));
}
