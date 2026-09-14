import { awardRequest, getProposal, getRequest, listProposals, setProposalStatus } from "@/lib/db";
import { handleError, HttpError, json, readSigned } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

function load(id: string, pid: string) {
  const request = getRequest(id);
  if (!request) throw new HttpError(404, "Request not found");
  const proposal = getProposal(Number(pid));
  if (!proposal || proposal.requestId !== id) throw new HttpError(404, "Proposal not found");
  return { request, proposal };
}

/**
 * Accept a proposal.
 *
 * This does not move any money. It records who the work went to, so the developer can
 * open an escrow at the price they quoted and the poster knows which listing to fund.
 * Deliberately reversible up to that point: nobody is committed until SOL is escrowed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; pid: string }> }) {
  try {
    const { id, pid } = await ctx.params;
    const { request, proposal } = load(id, pid);
    const { signer } = await readSigned(req, "award", id);

    if (signer !== request.poster) throw new HttpError(403, "Only the person who posted this can choose who builds it");
    if (request.status !== "open") throw new HttpError(409, `This request is already ${request.status}`);
    if (proposal.status === "withdrawn") throw new HttpError(409, "That proposal was withdrawn");

    awardRequest(id, proposal.id, proposal.dev);
    return json({ request: getRequest(id), proposals: listProposals(id) });
  } catch (e) {
    return handleError(e);
  }
}

/** Withdraw a proposal. Only its author, and not once it has been accepted. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; pid: string }> }) {
  try {
    const { id, pid } = await ctx.params;
    const { proposal } = load(id, pid);
    const { signer } = await readSigned(req, "withdraw-proposal", id);

    if (signer !== proposal.dev) throw new HttpError(403, "Only the developer who made this proposal can withdraw it");
    if (proposal.status === "accepted") {
      throw new HttpError(409, "This proposal was accepted. Talk to the poster rather than disappearing — cancel the escrow if one is open.");
    }
    setProposalStatus(proposal.id, "withdrawn");
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
