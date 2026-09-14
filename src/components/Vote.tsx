"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { signedPost } from "@/lib/client/api";

/**
 * The arrows.
 *
 * The count moves the instant you click and is corrected by whatever the server says,
 * because waiting a round trip to see your own vote land feels broken. A failure puts
 * the old numbers back rather than leaving a lie on screen.
 */
export function Vote({ kind, id, score, myVote, compact = false }: {
  kind: "post" | "comment";
  id: string | number;
  score: number;
  myVote: number;
  compact?: boolean;
}) {
  const wallet = useWallet();
  const [state, setState] = useState({ score, mine: myVote });
  const [busy, setBusy] = useState(false);

  async function vote(value: 1 | -1) {
    if (!wallet.publicKey || busy) return;
    const before = state;
    const next = state.mine === value ? 0 : value;
    setState({ score: state.score - state.mine + next, mine: next });
    setBusy(true);
    try {
      const r = await signedPost<{ score: number; myVote: number }>(wallet, "/api/forum/vote", "vote", null, { kind, id, value });
      setState({ score: r.score, mine: r.myVote });
    } catch {
      setState(before);
    } finally {
      setBusy(false);
    }
  }

  const arrow = (dir: 1 | -1) => (
    <button
      type="button"
      onClick={() => vote(dir)}
      disabled={!wallet.publicKey}
      aria-label={dir === 1 ? "Upvote" : "Downvote"}
      aria-pressed={state.mine === dir}
      title={wallet.publicKey ? undefined : "Connect a wallet to vote"}
      className="grid place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        width: compact ? 20 : 24, height: compact ? 20 : 24,
        color: state.mine === dir ? (dir === 1 ? "var(--color-green)" : "var(--color-rose)") : "var(--color-faint)",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden
        style={{ transform: dir === -1 ? "rotate(180deg)" : undefined }}>
        <path d="M6 1.5 11 9H1z" fill="currentColor" />
      </svg>
    </button>
  );

  return (
    <div className={`flex ${compact ? "flex-row items-center gap-1" : "flex-col items-center gap-0.5"} shrink-0`}>
      {arrow(1)}
      <span className="mono text-[13px] font-semibold tabular-nums"
        style={{ color: state.mine !== 0 ? "var(--color-ink)" : "var(--color-muted)" }}>
        {state.score}
      </span>
      {arrow(-1)}
    </div>
  );
}
