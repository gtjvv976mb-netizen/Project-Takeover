"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float, Html, Sparkles, Torus } from "@react-three/drei";
import * as THREE from "three";
import { BLUE, GOLD, GREEN, PURPLE } from "./palette";

/** Deterministic PRNG so the forge layout is stable across renders (and keeps render pure). */
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** How "present" a station is: 1 when the camera is at it, fading to 0 one station away. */
export const presence = (t: number, i: number) => THREE.MathUtils.clamp(1 - Math.abs(t - i), 0, 1);

/* ---------------- Station 1 · The Forge: fragments assemble into a token ---------------- */
export function Forge({ tRef, index }: { tRef: React.MutableRefObject<number>; index: number }) {
  const COUNT = 260;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { scattered, target } = useMemo(() => {
    const scattered: THREE.Vector3[] = [], target: THREE.Vector3[] = [];
    const rnd = mulberry32(1337);
    const geo = new THREE.IcosahedronGeometry(2.2, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < COUNT; i++) {
      const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2, r = 4.5 + rnd() * 4, k = Math.sqrt(1 - u * u);
      scattered.push(new THREE.Vector3(k * Math.cos(phi) * r, u * r, k * Math.sin(phi) * r));
      const j = Math.floor(rnd() * pos.count);
      target.push(new THREE.Vector3(pos.getX(j), pos.getY(j), pos.getZ(j)));
    }
    geo.dispose();
    return { scattered, target };
  }, []);
  useFrame(({ clock }) => {
    const p = presence(tRef.current, index);
    const a = THREE.MathUtils.smoothstep(p, 0.15, 0.95); // assembled amount
    const time = clock.elapsedTime;
    if (mesh.current) {
      for (let i = 0; i < COUNT; i++) {
        const s = scattered[i], tg = target[i];
        const wob = Math.sin(time * 1.3 + i) * 0.15 * (1 - a);
        dummy.position.set(THREE.MathUtils.lerp(s.x, tg.x, a) + wob, THREE.MathUtils.lerp(s.y, tg.y, a), THREE.MathUtils.lerp(s.z, tg.z, a) + wob);
        dummy.rotation.set(time * 0.5 + i, time * 0.3, 0);
        const sc = 0.12 + 0.1 * (1 - a);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i, dummy.matrix);
      }
      mesh.current.instanceMatrix.needsUpdate = true;
      mesh.current.rotation.y = time * 0.15;
    }
    if (core.current) {
      core.current.scale.setScalar(0.2 + a * 1.9);
      (core.current.material as THREE.MeshStandardMaterial).emissiveIntensity = a * 2.2;
      core.current.rotation.y = -time * 0.2;
    }
  });
  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={0.8} roughness={0.4} />
      </instancedMesh>
      <mesh ref={core}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial color={PURPLE} emissive={PURPLE} emissiveIntensity={0} roughness={0.3} metalness={0.5} />
      </mesh>
      <pointLight color={GREEN} intensity={25} distance={18} />
      <Sparkles count={60} scale={10} size={2} speed={0.6} color={GREEN} />
    </group>
  );
}

/* ---------------- Station 2 · The Scanner: a coin under a sweeping ring, facts materialize ---------------- */
export function Scanner({ tRef, index }: { tRef: React.MutableRefObject<number>; index: number }) {
  const coin = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const labels = useRef<HTMLDivElement[]>([]);
  const facts = [
    { text: "mint authority · revoked ✓", pos: [3.4, 1.6, 0] as [number, number, number], color: GREEN },
    { text: "supply · 1,000,000,000", pos: [3.6, 0.3, 0.5] as [number, number, number], color: BLUE },
    { text: "top 10 holders · 11.8% ✓", pos: [3.2, -1.0, 0] as [number, number, number], color: GREEN },
    { text: "creator · verified on-chain ✓", pos: [-3.6, 0.9, 0.3] as [number, number, number], color: PURPLE },
  ];
  useFrame(({ clock }) => {
    const p = presence(tRef.current, index);
    const time = clock.elapsedTime;
    if (coin.current) coin.current.rotation.y = time * 0.6;
    if (ring.current) ring.current.position.y = Math.sin(time * 1.4) * 1.5;
    labels.current.forEach((el, i) => {
      if (!el) return;
      const reveal = THREE.MathUtils.clamp((p - 0.35 - i * 0.12) / 0.3, 0, 1);
      el.style.opacity = String(reveal);
      el.style.transform = `translateY(${(1 - reveal) * 12}px)`;
    });
  });
  return (
    <group>
      <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.4}>
        <mesh ref={coin} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.7, 1.7, 0.28, 64]} />
          <meshStandardMaterial color={PURPLE} emissive={PURPLE} emissiveIntensity={0.5} metalness={0.8} roughness={0.25} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.72, 0.06, 12, 80]} />
          <meshBasicMaterial color={GREEN} />
        </mesh>
      </Float>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.6, 0.035, 8, 100]} />
        <meshBasicMaterial color={GREEN} transparent opacity={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.4, 0]}>
        <planeGeometry args={[10, 10, 20, 20]} />
        <meshBasicMaterial color={GREEN} wireframe transparent opacity={0.08} />
      </mesh>
      {facts.map((f, i) => (
        <Html key={f.text} position={f.pos} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => { if (el) labels.current[i] = el; }} className="whitespace-nowrap rounded-lg border px-2.5 py-1 font-mono text-[11px] backdrop-blur" style={{ borderColor: f.color + "66", color: f.color, background: "rgba(5,6,10,0.7)", opacity: 0, transition: "opacity .2s, transform .2s" }}>{f.text}</div>
        </Html>
      ))}
      <pointLight color={GREEN} intensity={18} distance={14} position={[0, 2, 2]} />
    </group>
  );
}

/* ---------------- Station 3 · The Vault: SOL flows in, the key flows out ---------------- */
export function Vault({ tRef, index }: { tRef: React.MutableRefObject<number>; index: number }) {
  const N = 14;
  const coins = useRef<THREE.Group>(null);
  const key = useRef<THREE.Group>(null);
  const box = useRef<THREE.Mesh>(null);
  const inCurve = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(-4.5, 7.5, 2), new THREE.Vector3(-3.2, 4, 1), new THREE.Vector3(-1.5, 1, 0.3), new THREE.Vector3(0, 0, 0)]), []);
  const outCurve = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(2.5, 1, 0.5), new THREE.Vector3(5, 3, 1), new THREE.Vector3(7, 6, 2)]), []);
  useFrame(({ clock }) => {
    const p = presence(tRef.current, index);
    const time = clock.elapsedTime;
    if (coins.current) {
      coins.current.children.forEach((c, i) => {
        const u = ((time * 0.25 + i / N) % 1);
        c.position.copy(inCurve.getPoint(u));
        c.scale.setScalar(p * (1 - THREE.MathUtils.smoothstep(u, 0.9, 1)) * 0.22);
      });
    }
    if (key.current) {
      const u = (time * 0.18) % 1;
      key.current.position.copy(outCurve.getPoint(u));
      key.current.rotation.z = time * 2;
      key.current.scale.setScalar(p * THREE.MathUtils.smoothstep(u, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(u, 0.92, 1)));
    }
    if (box.current) box.current.rotation.y = time * 0.25;
  });
  return (
    <group>
      <mesh ref={box}>
        <boxGeometry args={[2.6, 2.6, 2.6]} />
        <meshStandardMaterial color="#0b0d18" emissive={PURPLE} emissiveIntensity={0.35} metalness={0.7} roughness={0.3} transparent opacity={0.92} />
      </mesh>
      <mesh rotation={[0.4, 0.6, 0]}>
        <boxGeometry args={[3.1, 3.1, 3.1]} />
        <meshBasicMaterial color={GREEN} wireframe transparent opacity={0.3} />
      </mesh>
      <group ref={coins}>
        {Array.from({ length: N }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={1.2} />
          </mesh>
        ))}
      </group>
      <group ref={key}>
        <Torus args={[0.45, 0.12, 12, 32]}><meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={1} /></Torus>
        <mesh position={[0.9, 0, 0]}><boxGeometry args={[1.1, 0.2, 0.2]} /><meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={1} /></mesh>
        <mesh position={[1.25, -0.2, 0]}><boxGeometry args={[0.15, 0.3, 0.2]} /><meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={1} /></mesh>
      </group>
      <pointLight color={GOLD} intensity={18} distance={16} position={[-3, 2, 2]} />
      <pointLight color={GREEN} intensity={14} distance={16} position={[3, 2, 2]} />
      <Sparkles count={50} scale={8} size={2} speed={0.4} color={GOLD} />
    </group>
  );
}
