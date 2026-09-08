"use client";
import { useEffect, useRef } from "react";
import { PIER_COLOR, type HarborLayout, type Vessel } from "./layout";

/** A 2D chart of the basin. Click a dot to fly there; ships you filtered out fade. */
export function Minimap({
  layout,
  selectedId,
  dimmedIds,
  onPick,
}: {
  layout: HarborLayout;
  selectedId: string | null;
  dimmedIds: Set<string> | null;
  onPick: (v: Vessel) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const W = 150, H = 130;
  const b = layout.bounds;
  const toXY = (x: number, z: number) => [
    ((x - b.minX) / (b.maxX - b.minX)) * (W - 16) + 8,
    (1 - (z - b.minZ) / (b.maxZ - b.minZ)) * (H - 16) + 8,
  ];

  useEffect(() => {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, W, H);
    // the lock, at the seaward end
    const [lx, ly] = toXY(0, -34);
    c.strokeStyle = "rgba(255,194,122,0.5)";
    c.beginPath(); c.moveTo(lx - 16, ly); c.lineTo(lx + 16, ly); c.stroke();
    for (const v of layout.vessels) {
      const [x, y] = toXY(v.position[0], v.position[2]);
      const dim = dimmedIds?.has(v.listing.id);
      c.fillStyle = dim ? "rgba(120,140,160,0.25)" : PIER_COLOR[v.type];
      c.beginPath();
      c.arc(x, y, v.listing.id === selectedId ? 4.5 : 2.6, 0, Math.PI * 2);
      c.fill();
      if (v.listing.id === selectedId) {
        c.strokeStyle = "#e8eef5"; c.lineWidth = 1.2; c.stroke();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, selectedId, dimmedIds]);

  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      className="cursor-crosshair rounded-sm border border-line bg-ink/80"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        let best: Vessel | null = null, bestD = 14;
        for (const v of layout.vessels) {
          const [x, y] = toXY(v.position[0], v.position[2]);
          const d = Math.hypot(x - px, y - py);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best) onPick(best);
      }}
    />
  );
}
