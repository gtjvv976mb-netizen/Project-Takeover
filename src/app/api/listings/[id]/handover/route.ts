import { handleError, HttpError, json, requireListing } from "@/lib/api-utils";
import { pumpHandover } from "@/lib/solana";

export const dynamic = "force-dynamic";

/**
 * Has the creator role of a pump.fun listing actually reached the buyer?
 *
 * Read live from the chain, not from the listing's snapshot, and resolved through any
 * fee-sharing config: "the on-chain creator is now the buyer's wallet" is not enough when
 * that field can point at a config in which the seller still collects most of the fee.
 * Public, because it grants nothing. The buyer's release stays their own signed decision;
 * this just makes sure they take it looking at the truth.
 */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const l = requireListing((await ctx.params).id);
    if (l.type !== "pump_creator" || !l.mint) throw new HttpError(400, "Only pump.fun listings have an on-chain handover to check");
    const subject = l.buyer ?? l.seller;
    const { control, verdict, complete } = await pumpHandover(l.mint, subject);
    return json({
      subject,
      role: l.buyer ? "buyer" : "seller",
      complete,
      control,
      verdict,
      // True only when a buyer exists and the role is theirs outright.
      handedOver: Boolean(l.buyer) && verdict.full,
    });
  } catch (e) { return handleError(e); }
}
