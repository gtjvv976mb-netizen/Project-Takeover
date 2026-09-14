import { builderDirectory } from "@/lib/db";
import { json } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/** Everyone who has done something here, ordered by what they finished. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  return json(builderDirectory({
    skill: u.searchParams.get("skill") ?? undefined,
    openOnly: u.searchParams.get("open") === "1",
  }));
}
