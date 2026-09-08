"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor, Stars } from "@react-three/drei";
import * as THREE from "three";
import type { Listing } from "@/lib/types";
import { buildLayout, PIER_COLOR, type Vessel } from "./layout";
import { Water } from "./Water";
import { HarborStatic } from "./Harbor";
import { Fleet } from "./Fleet";
import { Rig, type RigHandle } from "./Rig";
import { HarborHUD } from "./HarborHUD";

const BG = "#060a12";

export default function World({ listings }: { listings: Listing[] }) {
  const router = useRouter();
  const layout = useMemo(() => buildLayout(listings), [listings]);
  const rig = useRef<RigHandle | null>(null);
  const hoverRef = useRef({ id: null as string | null, x: 0, y: 0 });
  const [hovered, setHovered] = useState<Vessel | null>(null);
  const [selected, setSelected] = useState<Vessel | null>(null);
  const [query, setQuery] = useState("");
  const [dpr, setDpr] = useState(1.5);

  const funded = useMemo(() => listings.filter((l) => l.status === "paid").length, [listings]);

  const dimmedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const s = new Set<string>();
    for (const v of layout.vessels) {
      const l = v.listing;
      const hay = `${l.title} ${l.token?.symbol ?? ""} ${l.token?.name ?? ""} ${l.seller} ${l.type}`.toLowerCase();
      if (!hay.includes(q)) s.add(l.id);
    }
    return s;
  }, [query, layout]);

  const matches = useMemo(
    () => (dimmedIds ? layout.vessels.filter((v) => !dimmedIds.has(v.listing.id)) : layout.vessels),
    [dimmedIds, layout],
  );

  const focus = useCallback((v: Vessel) => {
    setSelected(v);
    rig.current?.focus(v);
  }, []);

  // Escape clears the selection; / jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelected(null); rig.current?.home(); }
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        document.getElementById("harbor-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-0">
      <Canvas
        camera={{ position: [6, 46, 118], fov: 38, near: 0.5, far: 520 }}
        dpr={dpr}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.15; }}
      >
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
        <color attach="background" args={[BG]} />
        <fogExp2 attach="fog" args={[BG, 0.0055]} />
        <ambientLight intensity={0.85} color="#9dbfe0" />
        <hemisphereLight intensity={0.8} color="#3d5a76" groundColor="#070d14" />
        <directionalLight position={[-40, 60, 60]} intensity={1.0} color="#cfe2f5" />
        {/* warm fill from the quay lamps behind the camera */}
        <directionalLight position={[10, 26, 110]} intensity={0.5} color="#ffc27a" />
        <Stars radius={220} depth={70} count={2200} factor={4} fade speed={0.35} />
        <Suspense fallback={null}>
          <Water onClick={() => setSelected(null)} />
          <HarborStatic layout={layout} funded={funded} onSlipway={() => router.push("/sell")} />
          <Fleet
            layout={layout}
            hoverRef={hoverRef}
            selected={selected}
            dimmedIds={dimmedIds}
            onHover={setHovered}
            onSelect={focus}
          />
        </Suspense>
        <Rig layout={layout} apiRef={rig} />
      </Canvas>

      <HarborHUD
        layout={layout}
        listings={listings}
        hovered={hovered}
        hoverRef={hoverRef}
        selected={selected}
        dimmedIds={dimmedIds}
        matches={matches}
        query={query}
        setQuery={setQuery}
        onPick={focus}
        onClear={() => { setSelected(null); rig.current?.home(); }}
        onOverview={() => rig.current?.overview()}
        pierColor={PIER_COLOR}
      />
    </div>
  );
}
