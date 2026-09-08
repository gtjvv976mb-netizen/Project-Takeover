"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFrame } from "@react-three/fiber";
import { Billboard, Float, Html, Sparkles, Torus } from "@react-three/drei";
import * as THREE from "three";
import { formatSol, TYPE_LABELS, type Listing } from "@/lib/types";
import { BG, BLUE, GREEN, PURPLE } from "./palette";

export const TYPE_COLOR: Record<Listing["type"], string> = { token_authority: GREEN, pump_creator: PURPLE, offchain: BLUE };

/** Glowing Solana core everything orbits. */
export function Core({ scale = 1 }: { scale?: number }) {
  const inner = useRef<THREE.Mesh>(null);
  const wire = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (inner.current) inner.current.rotation.y += dt * 0.15;
    if (wire.current) { wire.current.rotation.y -= dt * 0.25; wire.current.rotation.x += dt * 0.1; }
  });
  return (
    <group scale={scale}>
      <mesh ref={inner}>
        <icosahedronGeometry args={[1.6, 3]} />
        <meshStandardMaterial color={PURPLE} emissive={PURPLE} emissiveIntensity={1.6} roughness={0.3} metalness={0.4} />
      </mesh>
      <mesh ref={wire}>
        <icosahedronGeometry args={[2.05, 1]} />
        <meshBasicMaterial color={GREEN} wireframe transparent opacity={0.35} />
      </mesh>
      <Torus args={[3.2, 0.03, 8, 120]} rotation={[Math.PI / 2.4, 0, 0]}><meshBasicMaterial color={GREEN} transparent opacity={0.7} /></Torus>
      <Torus args={[4.6, 0.02, 8, 140]} rotation={[Math.PI / 1.9, 0.4, 0]}><meshBasicMaterial color={PURPLE} transparent opacity={0.5} /></Torus>
      <pointLight color={PURPLE} intensity={40} distance={30} />
      <pointLight color={GREEN} intensity={20} distance={20} position={[0, 2, 0]} />
      <Sparkles count={120} scale={9} size={2.5} speed={0.35} color={GREEN} />
    </group>
  );
}

function ListingCard3D({ l, index, total, ghost }: { l: Listing | null; index: number; total: number; ghost?: boolean }) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  const ring = index % 2;
  const radius = ring === 0 ? 6.5 : 9.5;
  const angle = (index / total) * Math.PI * 2 + ring * 0.4;
  const y = ring === 0 ? 0.6 : -0.8;
  const color = l ? TYPE_COLOR[l.type] : "#ffffff";
  return (
    <group position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius]}>
      <Float speed={1.5} rotationIntensity={0.15} floatIntensity={0.6}>
        <Billboard>
          <mesh scale={hover ? 1.12 : 1.04} position={[0, 0, -0.02]}>
            <planeGeometry args={[2.6, 1.55]} />
            <meshBasicMaterial color={color} transparent opacity={ghost ? 0.05 : hover ? 0.45 : 0.18} side={THREE.DoubleSide} />
          </mesh>
          <mesh scale={hover ? 1.08 : 1}>
            <planeGeometry args={[2.6, 1.55]} />
            <meshBasicMaterial color={BG} transparent opacity={0.92} side={THREE.DoubleSide} />
          </mesh>
          <Html transform center distanceFactor={6} position={[0, 0, 0.06]} zIndexRange={[10, 0]} style={{ pointerEvents: ghost ? "none" : "auto" }}>
            <div
              onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
              onClick={() => l && router.push(`/listings/${l.id}`)}
              className={`w-[220px] select-none rounded border p-3 text-left backdrop-blur-sm transition ${ghost ? "border-line bg-ink-2 opacity-60" : "cursor-pointer bg-black/60"}`}
              style={{ borderColor: ghost ? undefined : color + "88", boxShadow: hover ? `0 0 24px ${color}66` : undefined }}
            >
              {l ? (
                <>
                  <div className="flex items-center gap-2">
                    {l.token?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.token.image} alt="" className="h-8 w-8 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold" style={{ background: color + "33", color }}>{(l.token?.symbol ?? l.title).slice(0, 3)}</div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{l.title}</div>
                      <div className="text-[10px]" style={{ color }}>{TYPE_LABELS[l.type]}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-base font-bold text-white">{formatSol(l.priceLamports)} SOL</span>
                    <span className="text-[10px] text-white/50">tap to take over →</span>
                  </div>
                </>
              ) : (
                <div className="text-center text-xs text-mute"><div className="text-lg">✦</div>your project here</div>
              )}
            </div>
          </Html>
        </Billboard>
      </Float>
    </group>
  );
}

export function Orbit({ listings }: { listings: Listing[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * 0.04; });
  const items = useMemo<(Listing | null)[]>(() => (listings.length ? listings.slice(0, 24) : Array(8).fill(null)), [listings]);
  return (
    <group ref={group}>
      {items.map((l, i) => <ListingCard3D key={l?.id ?? `ghost-${i}`} l={l} index={i} total={items.length} ghost={!l} />)}
    </group>
  );
}
