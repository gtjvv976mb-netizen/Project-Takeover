import { randomUUID } from "node:crypto";
import { insertRequest, listRequests } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";
import { REQUEST_CATEGORY_LABELS, type BuildRequest, type RequestCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const MIN_BUDGET_LAMPORTS = 10_000_000; // 0.01 SOL, same floor as a listing

export async function GET(req: Request) {
  const u = new URL(req.url);
  return json(listRequests({
    status: (u.searchParams.get("status") ?? "open") as BuildRequest["status"] | "all",
    category: u.searchParams.get("category") ?? undefined,
    poster: u.searchParams.get("poster") ?? undefined,
    dev: u.searchParams.get("dev") ?? undefined,
  }));
}

/**
 * Post work you want built.
 *
 * The mirror of creating a listing, and deliberately cheaper: nothing goes on chain here.
 * A request is a statement of intent, and the escrow only appears once a developer has
 * been chosen and there is a real price to hold.
 */
export async function POST(req: Request) {
  try {
    const { body, signer } = await readSigned<{
      title: string; brief: string; category: RequestCategory; budgetSol: number; deliveryDays: number;
    }>(req, "request", null);

    const title = (body.title ?? "").trim();
    const brief = (body.brief ?? "").trim();
    if (!title || title.length > 90) throw new HttpError(400, "Give it a title (up to 90 characters)");
    if (brief.length < 40) throw new HttpError(400, "Say a bit more about what you want built — at least 40 characters. Vague briefs get vague proposals.");
    if (brief.length > 6000) throw new HttpError(400, "That brief is too long (6000 characters max)");
    if (!(body.category in REQUEST_CATEGORY_LABELS)) throw new HttpError(400, "Pick a category");

    const budgetLamports = Math.round(Number(body.budgetSol) * 1e9);
    if (!Number.isFinite(budgetLamports) || budgetLamports < MIN_BUDGET_LAMPORTS) {
      throw new HttpError(400, "Give an indicative budget of at least 0.01 SOL");
    }
    const deliveryDays = Math.round(Number(body.deliveryDays));
    if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 90) {
      throw new HttpError(400, "Say when you want it, between 1 and 90 days");
    }

    const now = Date.now();
    const request: Omit<BuildRequest, "proposalCount"> = {
      id: randomUUID().slice(0, 8),
      poster: signer,
      title, brief, category: body.category,
      budgetLamports, deliveryDays,
      status: "open", awardedDev: null, listingId: null,
      createdAt: now, updatedAt: now,
    };
    insertRequest(request);
    return json({ ...request, proposalCount: 0 }, 201);
  } catch (e) {
    return handleError(e);
  }
}
