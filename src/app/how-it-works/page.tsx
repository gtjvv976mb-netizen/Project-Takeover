"use client";
import { useConfig } from "@/components/ConfigContext";
import Link from "next/link";

const FLOWS = [
  {
    n: "01",
    title: "Token authorities",
    tag: "Fully on chain",
    steps: [
      "You pick which authorities are for sale: mint, freeze, and the Metaplex metadata update authority.",
      "You sign one transaction handing them to the escrow program's own address — a key nobody has, not even us. The program itself refuses to list a token whose authorities have not arrived.",
      "A buyer pays. In that same transaction the program hands every authority to them and pays you, minus the fee. There is no moment where one side has both.",
      "Cancel any time before a sale and the authorities come straight back to you.",
    ],
  },
  {
    n: "02",
    title: "pump.fun coin ownership",
    tag: "Verified against the curve",
    steps: [
      "pump.fun tokens have mint and update authority revoked, so what actually transfers is the creator role: the creator fees and who receives them.",
      "The listing is checked against the bonding curve's on-chain creator field. Only the current creator can list.",
      "A buyer pays into escrow. You transfer ownership using pump.fun's own tool.",
      "Either side hits verify. The server reads the curve, and once the creator equals the buyer the funds release automatically.",
    ],
  },
  {
    n: "03",
    title: "Projects, sites and communities",
    tag: "Escrowed until delivered",
    steps: [
      "A buyer pays into escrow. You hand over the repo, domain, logins and admin roles, and leave a delivery note.",
      "The buyer confirms delivery and the funds release.",
      "If something is wrong, either side opens a dispute and an admin releases or refunds.",
    ],
  },
];

export default function HowItWorks() {
  const cfg = useConfig();
  return (
    <>
      <section className="border-b border-line">
        <div className="wrap py-10 pb-10">
          <div className="kicker">How it works</div>
          <h1 className="display mt-4">Nobody has<br />to trust anybody.</h1>
          <p className="lead mt-6">
            Three kinds of assets, three escrow flows. In every one of them the buyer&apos;s SOL is held by a program
            on Solana — not a company account — and only moves when the thing being sold has provably changed hands.
          </p>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="wrap py-10">
          {FLOWS.map((f) => (
            <div key={f.n} className="grid gap-6 border-b border-line py-10 last:border-b-0 md:grid-cols-[6rem_1fr]">
              <div>
                <div className="title-lg">{f.n}</div>
              </div>
              <div>
                <h2 className="title-lg">{f.title}</h2>
                <div className="mt-3 inline-block border border-blue px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-blue">
                  {f.tag}
                </div>
                <ol className="mt-5 space-y-3">
                  {f.steps.map((s, i) => (
                    <li key={i} className="grid grid-cols-[2rem_1fr] gap-3 border-t border-line pt-3 text-[15px] leading-relaxed">
                      <span className="mono text-muted">{String(i + 1).padStart(2, "0")}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-line bg-bg-2">
        <div className="wrap py-10">
          <h2 className="title-lg">We never sell wallets or private keys.</h2>
          <p className="mt-5 max-w-[60ch] text-[16px] leading-relaxed text-muted">
            A private key can be copied, so a wallet that has been &ldquo;sold&rdquo; is never really the buyer&apos;s.
            Instead you sell what the wallet <em>controls</em>: authorities move on chain, and everything else goes
            through a handover the escrow can verify or a human can arbitrate.
          </p>
          <div className="mt-10 grid gap-px bg-line sm:grid-cols-3">
            {[
              [`${cfg.feeBps / 100}%`, "Platform fee, taken from the seller's payout only when a deal settles. The program refuses to go above 5%, whoever asks."],
              ["0", "Private keys ever changing hands on this site."],
              ["1 tx", "For a token handover: the buyer is paid out and the seller is paid in the same transaction."],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface p-6">
                <div className="font-display text-[52px] leading-none text-brand">{k}</div>
                <p className="mt-3 text-[14px] leading-relaxed text-muted">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap py-10 flex flex-wrap items-center gap-6">
          <h2 className="title-lg flex-1">Ready to put<br />your work up?</h2>
          <Link href="/sell" className="btn btn-primary px-7 py-4 font-mono text-[12px] uppercase tracking-[0.16em]">
            List your work →
          </Link>
        </div>
      </section>
    </>
  );
}
