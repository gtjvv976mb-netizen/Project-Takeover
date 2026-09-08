"use client";
import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";
import { useConfig } from "@/components/ConfigContext";
import { useReducedMotion } from "@/lib/motion";
import { Ticks } from "./Tick";

/**
 * The live chain vitals in the masthead. The slot height is real: it polls the
 * cluster every 2s and advances locally between polls, so a nine-digit number is
 * always physically moving even with zero listings on the site.
 */
export function SlotHeight() {
  const cfg = useConfig();
  const reduced = useReducedMotion();
  const [slot, setSlot] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const conn = new Connection(cfg.rpcUrl, "confirmed");
    const poll = async () => {
      try {
        const s = await conn.getSlot("confirmed");
        if (alive) setSlot(s);
      } catch { /* offline or rate-limited; keep the last value */ }
    };
    poll();
    const pollId = setInterval(poll, 2000);
    // Solana produces a slot roughly every 400ms; advance locally between polls so
    // the digits are always physically moving, then resync on the next poll.
    const tickId = reduced ? null : setInterval(() => setSlot((s) => (s === null ? s : s + 1)), 400);
    return () => {
      alive = false;
      clearInterval(pollId);
      if (tickId) clearInterval(tickId);
    };
  }, [cfg.rpcUrl, reduced]);

  return (
    <span className="mono tabular-nums">
      {slot === null ? <span className="text-faint">—————————</span> : <Ticks value={slot.toLocaleString("en-US")} />}
    </span>
  );
}

export function Vital({ label, children, i = 0 }: { label: string; children: React.ReactNode; i?: number }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-rule-soft py-2 first:border-t-0">
      <span className="live-sq shrink-0" style={{ ["--i" as string]: i }} />
      <span className="kicker shrink-0">{label}</span>
      <span className="ml-auto text-[13px] font-medium">{children}</span>
    </div>
  );
}
