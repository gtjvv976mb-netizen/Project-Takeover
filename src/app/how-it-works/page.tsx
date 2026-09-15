"use client";
import { explorerUrl, useConfig } from "@/components/ConfigContext";
import Link from "next/link";

const FLOWS = [
  {
    n: "01",
    title: "Commissioned work",
    tag: "Requests → proposals → escrow",
    steps: [
      "Somebody posts what they need built — an app, a site, a bot, a coin — with a budget and a deadline. Posting is free and moves no money.",
      "Developers send proposals: how they would build it, what they would charge, how long it would take. The poster can read each one's track record before choosing.",
      "The poster picks one. That developer opens an escrow listing for the agreed price and the poster funds it. From here the flow is the same as buying a project: the SOL sits in an account the program owns.",
      "The developer delivers; the poster releases. If the deadline passes with nothing delivered, the refund is permissionless. If either side disputes, the funds freeze until an arbitrator picks between the two of them.",
    ],
  },
  {
    n: "02",
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
    n: "03",
    title: "pump.fun coin ownership",
    tag: "Verified against the curve",
    steps: [
      "pump.fun tokens have mint and update authority revoked, so what actually transfers is the creator role: the creator fees and who receives them.",
      "The listing is checked against the bonding curve's on-chain creator field. Only the current creator can list.",
      "A buyer pays into escrow. You transfer ownership using pump.fun's own tool.",
      "Once the creator role has moved, the buyer releases the escrow and you are paid. If they never do, the deadline returns their money and you keep the coin — so neither side can simply walk off with both.",
    ],
  },
  {
    n: "04",
    title: "Projects, sites and communities",
    tag: "Escrowed until delivered",
    steps: [
      "A buyer pays into escrow. You hand over the repo, domain, logins and admin roles, and leave a delivery note.",
      "The buyer confirms delivery and the funds release.",
      "If something is wrong, either side opens a dispute and the arbitrator picks a winner. It can only choose between the two of you, and if it says nothing for 14 days the buyer can take their money back without anyone\u2019s help.",
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
            Whether you are hiring a developer or buying what one already built, the money is held by a program
            on Solana — not a company account — and only moves when the work has provably changed hands.
            Four flows, one escrow.
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
                <div className="pill mt-3" style={{ ["--tint" as string]: "var(--color-blue)" }}>{f.tag}</div>
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

      {/* A site whose pitch is "don't trust us" should be able to say out loud where
          trust still sits. Everything here is verifiable by the reader, on purpose. */}
      <section className="border-b border-line">
        <div className="wrap py-14">
          <div className="kicker">Be suspicious</div>
          <h2 className="title-lg mt-4">What you are still trusting.</h2>
          <p className="lead mt-4">
            Every marketplace says it is safe. Here is the honest version, including the parts
            that are not cryptographic.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-bg p-6">
              <h3 className="text-[17px] font-bold text-ink">You do not have to trust us with</h3>
              <ul className="mt-3 space-y-2.5 text-[14.5px] leading-relaxed text-muted">
                <li><strong className="text-ink">Holding the asset.</strong> Escrowed authorities sit at an address derived from the program. It has no private key — not ours, not anyone&apos;s.</li>
                <li><strong className="text-ink">Paying the seller.</strong> For a token, payment and handover are the same instruction. Both happen or neither does.</li>
                <li><strong className="text-ink">Letting you out.</strong> Anyone can trigger the refund once the deadline passes, or once a dispute has gone 14 days unanswered. You never need our cooperation.</li>
                <li><strong className="text-ink">The fee.</strong> The program refuses to charge more than 5%, whoever asks it to.</li>
              </ul>
            </div>

            <div className="rounded-2xl border p-6" style={{ borderColor: "color-mix(in srgb, var(--color-amber) 40%, transparent)", background: "color-mix(in srgb, var(--color-amber) 7%, var(--color-tint-base))" }}>
              <h3 className="text-[17px] font-bold text-ink">You are still trusting</h3>
              <ul className="mt-3 space-y-2.5 text-[14.5px] leading-relaxed text-muted">
                <li>
                  {cfg.upgradeAuthority ? (
                    <>
                      <strong className="text-ink">That the program is not replaced.</strong> It can still be
                      upgraded, right now, by{" "}
                      <a className="mono break-all text-blue hover:underline" href={explorerUrl(cfg, "address", cfg.upgradeAuthority)} target="_blank" rel="noreferrer">
                        {cfg.upgradeAuthority}
                      </a>
                      {cfg.upgradeCustody === "squads"
                        ? <>, a vault of {cfg.squadsMultisig ? <a className="mono break-all text-blue hover:underline" href={`https://app.squads.so/squads/${cfg.squadsMultisig}/home`} target="_blank" rel="noreferrer">this Squads multisig</a> : "a Squads multisig"}
                          {cfg.squads
                            ? cfg.squads.threshold < 2
                              ? <>, which needs only {cfg.squads.threshold} of its {cfg.squads.members} member{cfg.squads.members === 1 ? "" : "s"} to approve an upgrade. That is a single key with extra steps, and you should treat it as one until the threshold is raised.</>
                              : <>: {cfg.squads.threshold} of {cfg.squads.members} members must approve an upgrade{cfg.squads.timeLockSeconds > 0 ? `, and a time lock holds it for ${Math.round(cfg.squads.timeLockSeconds / 3600)} hours after that, so it can be seen coming before it lands` : ", though no time lock delays it, so an approved upgrade lands at once"}. It is scheduled to be destroyed outright once the program has been audited.</>
                            : <>: several people have to sign an upgrade. It is scheduled to be destroyed outright once the program has been audited.</>}</>
                        : cfg.upgradeCustody === "wallet"
                          ? ", a single wallet. One key could deploy a version that does hold your funds. It is scheduled to be handed to a multisig, then destroyed outright once the program has been audited."
                          : cfg.upgradeCustody === "program"
                            ? ", a program-derived address: no private key exists for it, so whichever program controls it decides. It is not one we have declared, so check it yourself."
                            : ". Whoever controls that account could deploy a version that does hold your funds."}
                      {" "}This line is read from the chain, so it will change when that happens
                      rather than waiting for someone to update the copy.
                    </>
                  ) : (
                    <>
                      <strong className="text-ink">Nothing, on this point any more.</strong> The program has
                      been made immutable: nobody can replace it, including us. Verify with{" "}
                      <span className="mono">solana program show {cfg.programId}</span>.
                    </>
                  )}
                </li>
                <li><strong className="text-ink">The arbitrator, on disputes.</strong> It can only choose between the buyer and the seller — it cannot pay itself or a third party — and if it stays silent for 14 days the buyer simply takes their money back.</li>
                <li><strong className="text-ink">The seller, for anything off-chain.</strong> A repo, a domain, a Discord: no blockchain can verify delivery. Your money is held until you confirm, and refunded if the deadline passes, but the handover itself is a human one.</li>
              </ul>
            </div>
          </div>

          <p className="mt-6 text-[13.5px] leading-relaxed text-faint">
            You can check the first list yourself rather than believing it. The program id,
            the treasury and the arbitrator are all public, and{" "}
            <span className="mono">solana program show</span> will tell you who can replace the
            program at any moment.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap flex flex-wrap items-center gap-6 py-12">
          <h2 className="title-lg flex-1">Ready?</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/requests#post" className="btn btn-secondary">Post what you need built</Link>
            <Link href="/sell" className="btn btn-primary">List a project</Link>
          </div>
        </div>
      </section>
    </>
  );
}
