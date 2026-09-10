"use client";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import type { TokenInfo } from "@/lib/types";
import { Alert, Button, Chip, TokenAvatar } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { explorerUrl, useConfig } from "@/components/ConfigContext";

type Coin = {
  configured: boolean;
  mint: string | null;
  symbol: string | null;
  graduationSol?: number;
  token: TokenInfo | null;
};

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="kicker">{label}</div>
      <div className="mt-1.5 text-[clamp(22px,2.6vw,30px)] font-bold leading-none text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-[13px] text-faint">{hint}</div>}
    </div>
  );
}

export default function CoinPage() {
  const cfg = useConfig();
  const wallet = useWallet();
  const { connection } = useConnection();
  const [coin, setCoin] = useState<Coin | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/coin").then((r) => r.json()).then((c) => { if (!off) setCoin(c); }).catch(() => {});
    return () => { off = true; };
  }, []);

  // Read the connected wallet's holding straight from its own token account.
  const mint = coin?.mint;
  const owner = wallet.publicKey;
  const decimals = coin?.token?.decimals ?? 6;
  useEffect(() => {
    if (!mint || !owner) return;
    let off = false;
    (async () => {
      try {
        const ata = await getAssociatedTokenAddress(new PublicKey(mint), owner);
        const acct = await getAccount(connection, ata);
        if (!off) setBalance(Number(acct.amount) / 10 ** decimals);
      } catch {
        // no token account means they simply hold none
        if (!off) setBalance(0);
      }
    })();
    return () => { off = true; };
  }, [mint, owner, connection, decimals]);

  if (!coin) return <div className="wrap py-16 text-muted">Loading…</div>;

  if (!coin.configured) {
    return (
      <div className="wrap max-w-2xl py-16 text-center">
        <div className="mx-auto w-fit"><Logo size={64} /></div>
        <h1 className="title-lg mt-6">No coin yet</h1>
        <p className="lead mx-auto mt-3">
          There is no token for this project at the moment. If one is ever launched it will show up
          here, read live from its bonding curve, and nowhere else on the site will pretend otherwise.
        </p>
      </div>
    );
  }

  const t = coin.token;
  const p = t?.pump;
  const sym = coin.symbol ?? t?.symbol ?? "COIN";
  const fmt = (n: number) => (n < 0.000001 ? n.toExponential(2) : n.toPrecision(4));

  return (
    <div className="wrap py-10">
      <header className="flex flex-wrap items-center gap-5">
        <TokenAvatar image={t?.image} symbol={sym} size={72} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tint="var(--color-tangerine)">pump.fun coin</Chip>
            {p?.complete && <Chip tint="var(--color-blue)">graduated</Chip>}
          </div>
          <h1 className="title-lg mt-2">{t?.name ?? "The coin"} <span className="text-muted">${sym}</span></h1>
        </div>
        <div className="ml-auto flex gap-2">
          <a href={`https://pump.fun/coin/${coin.mint}`} target="_blank" rel="noreferrer noopener"><Button>Buy on pump.fun</Button></a>
        </div>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Price" value={p?.priceSol != null ? `${fmt(p.priceSol)} SOL` : "—"} hint={p?.complete ? "trading on a pool now" : "from the bonding curve"} />
        <Stat label="Market cap" value={p?.marketCapSol != null ? `${Math.round(p.marketCapSol).toLocaleString()} SOL` : "—"} />
        <Stat label="In the curve" value={p?.solRaised != null ? `${p.solRaised.toFixed(1)} SOL` : "—"} hint={coin.graduationSol ? `~${coin.graduationSol} to graduate` : undefined} />
        <Stat
          label="You hold"
          value={balance == null ? "—" : balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          hint={!wallet.publicKey ? "connect a wallet" : undefined}
        />
      </div>

      {p && !p.complete && p.progress != null && (
        <div className="card mt-4 p-5">
          <div className="flex items-baseline justify-between">
            <div className="kicker">Progress to graduation</div>
            <div className="text-[14px] font-semibold text-ink">{Math.round(p.progress * 100)}%</div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-bg-2">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(p.progress * 100)}%`, background: "linear-gradient(90deg,var(--color-brand),var(--color-teal))" }} />
          </div>
          <p className="mt-2.5 text-[13px] text-faint">
            pump.fun has changed this threshold before, so read the percentage as a rough indicator
            rather than a precise countdown.
          </p>
        </div>
      )}

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-[19px] font-bold text-ink">What it is</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            A community coin for the people who use this marketplace. It is a pump.fun coin like any
            other, and everything above is read live from its bonding curve on chain rather than from
            anything we type in.
          </p>
        </div>
        <div className="card p-6">
          <h2 className="text-[19px] font-bold text-ink">What it is not</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            It is not a share, it does not entitle you to platform revenue, and holding it is not
            required to buy or sell anything here. The escrow works identically whether you hold a
            single token or none at all.
          </p>
        </div>
      </section>

      {coin.mint && (
        <p className="mt-8 text-[13px] text-faint">
          Mint{" "}
          <a className="mono break-all text-blue hover:underline" href={explorerUrl(cfg, "address", coin.mint)} target="_blank" rel="noreferrer">
            {coin.mint}
          </a>
        </p>
      )}

      <div className="mt-6">
        <Alert kind="warn">
          Memecoins are volatile and most go to zero. Only put in what you are content to lose.
        </Alert>
      </div>
    </div>
  );
}
