export default function HowItWorks() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-3xl font-bold">How it works</h1>
      <p className="mt-3 text-mute">Project: Takeover exists so independent developers who build real things on Solana have somewhere to show them, and someone to sell them to. Buyers get verified control, builders get paid, and the work keeps living.</p>

      <h2 className="mt-8 text-xl font-semibold">For builders</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">
        <li>Your wallet is your résumé. Every listing is tied to the wallet that provably owns the asset on-chain, and your builder page shows what you shipped, what sold, and what you earned.</li>
        <li>List a full project (code + token + site), just a token&apos;s authorities, a pump.fun coin&apos;s creator role, or a site or community on its own.</li>
        <li>Buyers see a proof-of-work block read straight from chain: supply, authorities, holder concentration, pump.fun status. Pitch less, prove more.</li>
      </ul>

      <h2 className="mt-8 text-xl font-semibold">The escrow flows</h2>
      <p className="mt-2 text-mute">Three kinds of assets, three escrow flows. In every case the buyer&apos;s SOL sits in the escrow wallet until the asset has provably changed hands.</p>

      <h2 className="mt-8 text-xl font-semibold">1. Token authorities (fully on-chain)</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">
        <li>Seller creates a listing and picks which authorities to sell: mint authority, freeze authority, and/or Metaplex metadata update authority.</li>
        <li>Seller signs one transaction moving those authorities to the escrow wallet. The listing only goes live after the server verifies this on-chain.</li>
        <li>Buyer pays the price into escrow. In a single atomic transaction the escrow transfers every authority to the buyer and pays the seller (minus the platform fee).</li>
        <li>Seller can cancel any time before a sale; authorities are returned automatically.</li>
      </ul>

      <h2 className="mt-8 text-xl font-semibold">2. pump.fun coin ownership &amp; creator fees</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">
        <li>pump.fun tokens have their mint and update authorities revoked, so the transferable asset is the <em>coin creator</em> role, which controls creator-fee recipients and fee splits.</li>
        <li>The listing is verified against the bonding curve&apos;s on-chain creator field. Only the current creator can list.</li>
        <li>Buyer pays into escrow. The seller then transfers ownership to the buyer&apos;s wallet using pump.fun&apos;s own transfer tool.</li>
        <li>Either party clicks <strong>Verify handoff</strong>. The server reads the bonding curve; once the creator equals the buyer, funds release to the seller automatically. The buyer can also release manually.</li>
      </ul>

      <h2 className="mt-8 text-xl font-semibold">3. Websites, domains, socials, communities</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">
        <li>Buyer pays into escrow. Seller hands over logins, DNS, admin roles, etc. off-platform and leaves a delivery note.</li>
        <li>Buyer confirms delivery to release funds. If something is wrong, either side opens a dispute and an admin releases or refunds.</li>
      </ul>

      <h2 className="mt-8 text-xl font-semibold">Why we never sell wallets or private keys</h2>
      <p className="mt-2 text-mute">
        A private key can be copied, so a &quot;sold&quot; wallet is never truly the buyer&apos;s. Instead, list what the wallet <em>controls</em>: authorities move on-chain, and everything else goes through handoff escrow.
      </p>

      <h2 className="mt-8 text-xl font-semibold">Fees</h2>
      <p className="mt-2 text-mute">A flat platform fee (default 2%) is deducted from the seller&apos;s payout at settlement. Buyers pay only Solana network fees.</p>
    </article>
  );
}
