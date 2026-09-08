"use client";
import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";
import { useConfig } from "./ConfigContext";
import { useReducedMotion } from "@/lib/motion";

/** The live Solana slot height. Real data, so the page has a genuine pulse. */
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
      } catch { /* offline or rate limited; keep the last value */ }
    };
    poll();
    const pollId = setInterval(poll, 2000);
    const tickId = reduced ? null : setInterval(() => setSlot((s) => (s === null ? s : s + 1)), 400);
    return () => { alive = false; clearInterval(pollId); if (tickId) clearInterval(tickId); };
  }, [cfg.rpcUrl, reduced]);

  return <span className="mono">{slot === null ? "—" : slot.toLocaleString("en-US")}</span>;
}
