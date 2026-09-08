import { listEvents } from "@/lib/db";
import { handleError, json, requireListing } from "@/lib/api-utils";
export const dynamic = "force-dynamic";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const l = requireListing((await ctx.params).id);
    return json({ listing: l, events: listEvents(l.id) });
  } catch (e) { return handleError(e); }
}
