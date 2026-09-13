// SERVER ONLY. Proving that a listing's seller controls the domain they are selling.
import "server-only";
import { promises as dns } from "node:dns";
import { expectedTxt, hostOf, type DomainProof } from "./domain";

export { expectedTxt, hostOf };
export type { DomainProof };

/**
 * Off-chain listings are the one asset class with no on-chain fact to check.
 *
 * A token listing cannot be faked: the program refuses unless the seller holds the
 * authorities, and the listing only goes live once they are in the program's custody.
 * A pump.fun listing cannot be faked either. But "I am selling this website" is a
 * sentence, and anyone can type it about somebody else's website.
 *
 * DNS is the exception. A domain's TXT records can only be set by whoever controls the
 * domain, so a record naming the seller's wallet is a real proof of control — free,
 * deterministic, and impossible to forge without the thing being sold. It does not cover
 * every off-chain asset, but it covers websites and domains, which are most of them.
 *
 * What this deliberately does not do is treat an unproven listing as fraudulent. Plenty
 * of honest sellers will not bother. It draws the line between "proven" and "claimed" and
 * lets the buyer see which they are looking at.
 */


/**
 * Look for `takeover-verify=<wallet>` in the host's TXT records, and in `_takeover.<host>`.
 *
 * The subdomain is offered because some registrars make editing the apex TXT awkward and
 * because an apex record is shared with SPF and DMARC. Either location counts.
 *
 * Network failures are reported as unverified with the reason, never thrown: a registrar
 * being slow must not stop someone listing.
 */
export async function checkDomain(url: string, wallet: string): Promise<DomainProof | null> {
  const host = hostOf(url);
  if (!host) return null;
  const want = expectedTxt(wallet);

  const lookup = async (name: string): Promise<string[]> => {
    try {
      const records = await dns.resolveTxt(name);
      // Each record arrives as an array of strings that the DNS layer split; rejoin them.
      return records.map((chunks) => chunks.join("").trim());
    } catch {
      return [];
    }
  };

  const [apex, sub] = await Promise.all([lookup(host), lookup(`_takeover.${host}`)]);
  const all = [...apex, ...sub];
  if (all.some((t) => t === want)) return { host, verified: true, detail: `TXT record found for ${host}` };
  if (all.length === 0) return { host, verified: false, detail: `No TXT records found for ${host} or _takeover.${host}` };
  const mine = all.filter((t) => t.startsWith("takeover-verify="));
  if (mine.length) {
    return { host, verified: false, detail: `Found ${mine.join(", ")} — expected ${want}. That record names a different wallet.` };
  }
  return { host, verified: false, detail: `${all.length} TXT record(s) found, none of them ${want}` };
}

/**
 * Verify every link on an off-chain listing. A listing counts as proven when at least one
 * of its links resolves to a domain the seller demonstrably controls.
 *
 * Bounded and time-boxed: ten links at most, five seconds in total. A listing page must
 * render whether or not somebody's nameserver answers.
 */
export async function checkLinks(links: string[], wallet: string): Promise<{ verified: boolean; proofs: DomainProof[] }> {
  const capped = links.slice(0, 10);
  const results = await Promise.race([
    Promise.all(capped.map((l) => checkDomain(l, wallet).catch(() => null))),
    new Promise<null>((r) => setTimeout(() => r(null), 5000)),
  ]);
  const proofs = (results ?? []).filter((p): p is DomainProof => p !== null);
  return { verified: proofs.some((p) => p.verified), proofs };
}
