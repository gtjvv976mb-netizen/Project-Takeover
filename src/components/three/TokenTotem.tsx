"use client";
import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Html, OrbitControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import type { AuthorityKind, TokenInfo } from "@/lib/types";
import { BG, BLUE, GOLD, GREEN, PURPLE } from "./palette";

function useImageTexture(url?: string | null) {
  const [loaded, setLoaded] = useState<{ url: string; tex: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (t) => { if (alive) { t.colorSpace = THREE.SRGBColorSpace; setLoaded({ url, tex: t }); } });
    return () => { alive = false; };
  }, [url]);
  return url && loaded?.url === url ? loaded.tex : null;
}

const RING: { kind: AuthorityKind; label: string; color: string; tilt: [number, number, number]; r: number }[] = [
  { kind: "mint", label: "mint", color: GREEN, tilt: [Math.PI / 2.6, 0, 0], r: 2.4 },
  { kind: "freeze", label: "freeze", color: BLUE, tilt: [Math.PI / 2, 0.9, 0], r: 2.8 },
  { kind: "metadata_update", label: "metadata", color: PURPLE, tilt: [Math.PI / 1.7, -0.9, 0], r: 3.2 },
];

function Totem({ token, included, status }: { token: TokenInfo | null; included: AuthorityKind[]; status?: string }) {
  const tex = useImageTexture(token?.image);
  const coin = useRef<THREE.Mesh>(null);
  const rings = useRef<THREE.Mesh[]>([]);
  useFrame(({ clock }, dt) => {
    if (coin.current) coin.current.rotation.y += dt * 0.5;
    rings.current.forEach((r, i) => { if (r) r.rotation.z += dt * (0.2 + i * 0.1); });
    void clock;
  });
  const held = (k: AuthorityKind) => k === "mint" ? token?.mintAuthority : k === "freeze" ? token?.freezeAuthority : token?.updateAuthority;
  const holders = token?.holders?.top.slice(0, 10) ?? [];
  const max = holders.reduce((m, h) => Math.max(m, Number(h.amount)), 0) || 1;
  const funded = status === "paid" || status === "sold";
  return (
    <group>
      <Float speed={1.3} rotationIntensity={0.25} floatIntensity={0.5}>
        <mesh ref={coin} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.5, 1.5, 0.26, 64]} />
          <meshStandardMaterial color={tex ? "#ffffff" : PURPLE} map={tex ?? undefined} emissive={tex ? "#000000" : PURPLE} emissiveIntensity={tex ? 0 : 0.5} metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.52, 0.06, 12, 80]} />
          <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.6} metalness={0.9} roughness={0.2} />
        </mesh>
      </Float>
      {RING.map((r, i) => {
        const on = included.includes(r.kind);
        const exists = !!held(r.kind);
        return (
          <group key={r.kind} rotation={r.tilt}>
            <mesh ref={(el) => { if (el) rings.current[i] = el; }}>
              <torusGeometry args={[r.r, on ? 0.045 : 0.02, 8, 120]} />
              <meshBasicMaterial color={on ? r.color : "#ffffff"} transparent opacity={on ? 0.95 : exists ? 0.3 : 0.08} />
            </mesh>
            <Html position={[r.r, 0, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              <span className="whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[10px]" style={{ borderColor: (on ? r.color : "#ffffff") + "55", color: on ? r.color : "rgba(255,255,255,0.45)", background: "rgba(5,6,10,0.75)" }}>
                {r.label} · {on ? "included" : exists ? "not for sale" : "revoked"}
              </span>
            </Html>
          </group>
        );
      })}
      {/* holder distribution: top 10 accounts as columns behind the coin */}
      <group position={[0, -2.6, -2.5]}>
        {holders.map((h, i) => {
          const hgt = 0.2 + (Number(h.amount) / max) * 2.2;
          const x = (i - (holders.length - 1) / 2) * 0.55;
          return (
            <mesh key={h.address} position={[x, hgt / 2, 0]}>
              <boxGeometry args={[0.35, hgt, 0.35]} />
              <meshStandardMaterial color={i === 0 ? PURPLE : GREEN} emissive={i === 0 ? PURPLE : GREEN} emissiveIntensity={0.5} transparent opacity={0.85} />
            </mesh>
          );
        })}
        {holders.length > 0 && (
          <Html position={[0, -0.9, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
            <span className="whitespace-nowrap font-mono text-[10px] text-white/50">top {holders.length} holders · {((token?.holders?.top10Share ?? 0) * 100).toFixed(1)}% of supply</span>
          </Html>
        )}
      </group>
      {funded && <Sparkles count={90} scale={7} size={3} speed={0.8} color={GOLD} />}
      <pointLight color={PURPLE} intensity={20} distance={16} position={[-3, 3, 3]} />
      <pointLight color={GREEN} intensity={14} distance={16} position={[3, -1, 3]} />
    </group>
  );
}

export default function TokenTotem({ token, included = [], status, className = "" }: { token: TokenInfo | null; included?: AuthorityKind[]; status?: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-md border border-line ${className}`} style={{ background: BG }}>
      <Canvas camera={{ position: [0, 1.5, 8.5], fov: 45 }} dpr={[1, 1.75]}>
        <color attach="background" args={[BG]} />
        <ambientLight intensity={0.5} />
        <Totem token={token} included={included} status={status} />
        <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.8} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-white/35">drag to inspect</div>
    </div>
  );
}
