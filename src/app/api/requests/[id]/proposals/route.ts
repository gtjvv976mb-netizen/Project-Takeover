import { getRequest, listProposals, upsertProposal } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

const MIN_PRICE_LAMPORTS = 10_000_000; // 0.01 SOL

/**
 * Offer to build the thing.
 *
 * The price here is the one that matters: the request's budget is what the poster hoped
 * to pay, this is what the developer will do it for, and it is this figure the escrow
 * ends up holding. Nothing is signed on chain yet — that happens when the poster picks
 * someone and the developer opens the listing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const request = getRequest(id);
    if (!request) throw new HttpError(404, "Request not found");

    const { body, signer } = await readSigned<{ pitch: string; priceSol: number; deliveryDays: number }>(
      req, "propose", id,
    );

    if (request.status !== "open") throw new HttpError(409, `This request is ${request.status} and is not taking proposals`);
    if (signer === request.poster) throw new HttpError(400, "You cannot bid on your own request");

    const pitch = (body.pitch ?? "").trim();
    if (pitch.length < 30) throw new HttpError(400, "Say how you would build it — at least 30 characters.");
    if (pitch.length > 4000) throw new HttpError(400, "That pitch is too long (4000 characters max)");

    const priceLamports = Math.round(Number(body.priceSol) * 1e9);
    if (!Number.isFinite(priceLamports) || priceLamports < MIN_PRICE_LAMPORTS) {
      throw new HttpError(400, "Name a price of at least 0.01 SOL");
    }
    const deliveryDays = Math.round(Number(body.deliveryDays));
    if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 90) {
      throw new HttpError(400, "Say how long you need, between 1 and 90 days");
    }

    const proposal = upsertProposal({
      requestId: id, dev: signer, pitch, priceLamports, deliveryDays, status: "open",
    });
    return json(proposal, 201);
  } catch (e) {
    return handleError(e);
  }
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return json(listProposals(id));
  } catch (e) {
    return handleError(e);
  }
}
