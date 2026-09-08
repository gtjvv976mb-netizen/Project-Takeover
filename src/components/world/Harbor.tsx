"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { berthOutline } from "./hulls";
import { Sign } from "./Sign";
import { berthPosition, PIER_COLOR, PIER_LABEL, PIER_ORDER, PIER_X, pierLength, type HarborLayout } from "./layout";
import type { ListingType } from "@/lib/types";

const CONCRETE = "#131c27";
const CONCRETE_LIT = "#1d2a38";

/** A lamp post with its warm pool of light. Point lights are expensive, so the
 *  pool is faked with an additive disc and only a few real lights exist. */
function Lamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.6, 0]}><cylinderGeometry args={[0.07, 0.09, 3.2, 6]} /><meshStandardMaterial color="#26333f" /></mesh>
      <mesh position={[0, 3.25, 0]}><sphereGeometry args={[0.22, 10, 10]} /><meshBasicMaterial color="#ffd9a8" toneMapped={false} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <circleGeometry args={[3.4, 20]} />
        <meshBasicMaterial color="#ffc27a" transparent opacity={0.045} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** One pier: deck, piles, bollards, lamps, a name board, and an outline at every berth. */
function Pier({ type, berths, occupied }: { type: ListingType; berths: number; occupied: Set<number> }) {
  const x = PIER_X[type];
  const len = pierLength(berths);
  const outline = useMemo(() => berthOutline(), []);
  const rows = Math.ceil(berths / 2);

  return (
    <group>
      <mesh position={[x, 0.28, len / 2]} receiveShadow>
        <boxGeometry args={[5.2, 0.56, len]} />
        <meshStandardMaterial color={CONCRETE_LIT} roughness={0.92} />
      </mesh>
      {Array.from({ length: rows + 1 }).map((_, i) => (
        <group key={i}>
          {[-2.2, 2.2].map((dx) => (
            <mesh key={dx} position={[x + dx, -0.5, 4 + i * 8]}>
              <cylinderGeometry args={[0.26, 0.26, 2.2, 6]} />
              <meshStandardMaterial color="#0e161f" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
      {Array.from({ length: berths }).map((_, i) => {
        const [bx, , bz] = berthPosition(type, i);
        const bollardX = x + (i % 2 === 0 ? -2.4 : 2.4);
        return (
          <group key={i}>
            <mesh position={[bollardX, 0.75, bz]}>
              <cylinderGeometry args={[0.19, 0.24, 0.82, 8]} />
              <meshStandardMaterial color={occupied.has(i) ? PIER_COLOR[type] : "#2b3947"} emissive={occupied.has(i) ? PIER_COLOR[type] : "#000000"} emissiveIntensity={occupied.has(i) ? 0.5 : 0} roughness={0.6} metalness={0.4} />
            </mesh>
            {!occupied.has(i) && (
              <lineLoop position={[bx, 0.05, bz]} rotation={[0, i % 2 === 0 ? Math.PI : 0, 0]}>
                <primitive object={outline} attach="geometry" />
                <lineBasicMaterial color="#3a4b5c" transparent opacity={0.5} />
              </lineLoop>
            )}
          </group>
        );
      })}
      {Array.from({ length: Math.max(2, Math.ceil(rows / 2)) }).map((_, i) => (
        <Lamp key={i} position={[x, 0.56, 8 + i * 16]} />
      ))}
      <Sign text={PIER_LABEL[type]} position={[x, 4.2, 0.5]} color={PIER_COLOR[type]} width={14} fontSize={44} />
    </group>
  );
}

/** The lighthouse: its beam sweeping the basin is the chain vouching for every hull. */
function Lighthouse() {
  const beam = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (beam.current) beam.current.rotation.y = clock.elapsedTime * 0.42;
  });
  return (
    <group position={[-46, 0, -16]}>
      <mesh position={[0, 5, 0]}><cylinderGeometry args={[1.5, 2.6, 10, 12]} /><meshStandardMaterial color={CONCRETE} roughness={0.9} /></mesh>
      <mesh position={[0, 10.6, 0]}><cylinderGeometry args={[1.75, 1.75, 1.4, 12]} /><meshStandardMaterial color="#0f1822" roughness={0.7} metalness={0.4} /></mesh>
      <mesh position={[0, 10.6, 0]}><sphereGeometry args={[0.95, 12, 12]} /><meshBasicMaterial color="#f2f8ff" toneMapped={false} /></mesh>
      <pointLight position={[0, 10.6, 0]} color="#dff0ff" intensity={110} distance={70} />
      <group ref={beam} position={[0, 10.6, 0]}>
        <mesh rotation={[0, 0, -Math.PI / 2]} position={[26, 0, 0]}>
          <coneGeometry args={[3.0, 44, 4, 1, true]} />
          <meshBasicMaterial color="#cfe6ff" transparent opacity={0.042} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * The lock gate: escrow, drawn as something everyone already understands.
 * Closed while money is held; the chamber lights when a deal is funded.
 */
function Lock({ funded }: { funded: number }) {
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = funded > 0 ? 0.16 + Math.sin(clock.elapsedTime * 1.8) * 0.07 : 0.03;
  });
  return (
    <group position={[0, 0, -34]}>
      {[-13, 13].map((x) => (
        <mesh key={x} position={[x, 1.6, 0]}>
          <boxGeometry args={[12, 3.6, 5]} />
          <meshStandardMaterial color={CONCRETE} roughness={0.95} />
        </mesh>
      ))}
      {[-4.2, 4.2].map((x, i) => (
        <mesh key={x} position={[x, 1.5, 0]} rotation={[0, i === 0 ? 0.16 : -0.16, 0]}>
          <boxGeometry args={[8.6, 3.2, 0.7]} />
          <meshStandardMaterial color="#1a2836" metalness={0.65} roughness={0.45} emissive="#ffc27a" emissiveIntensity={funded > 0 ? 0.32 : 0.05} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 3]}>
        <planeGeometry args={[16, 12]} />
        <meshBasicMaterial ref={glow} color="#ffc27a" transparent opacity={0.03} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <Sign text={funded > 0 ? `THE LOCK · ${funded} DEAL${funded > 1 ? "S" : ""} IN ESCROW` : "THE LOCK · ESCROW"} position={[0, 5.4, 0]} color="#ffc27a" width={14} fontSize={44} />
    </group>
  );
}

/** The slipway: a half-built wireframe hull on the stocks. This is /sell. */
function Slipway({ onClick }: { onClick: () => void }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = 0.9 + Math.sin(clock.elapsedTime * 0.9) * 0.05;
  });
  return (
    <group position={[-30, 0, 30]} onClick={onClick} onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "auto")}>
      <mesh position={[0, 0.3, 0]} rotation={[-0.09, 0, 0]}>
        <boxGeometry args={[10, 0.6, 16]} />
        <meshStandardMaterial color={CONCRETE} roughness={0.95} />
      </mesh>
      {[-3, 0, 3].map((z) => (
        <mesh key={z} position={[0, 0.85, z * 2]}><boxGeometry args={[3.4, 0.5, 0.5]} /><meshStandardMaterial color="#22303d" /></mesh>
      ))}
      <group ref={g}>
        <mesh position={[0, 0.9, 0]}>
          <boxGeometry args={[2.4, 1.5, 7.5]} />
          <meshBasicMaterial color="#46e5a0" wireframe transparent opacity={0.42} />
        </mesh>
      </group>
      <Sign text="THE SLIPWAY · LIST YOUR WORK" position={[0, 5.0, 0]} color="#46e5a0" width={13} fontSize={42} />
    </group>
  );
}

export function HarborStatic({ layout, funded, onSlipway }: { layout: HarborLayout; funded: number; onSlipway: () => void }) {
  const occupied = useMemo(() => {
    const m: Record<string, Set<number>> = { token_authority: new Set(), pump_creator: new Set(), offchain: new Set() };
    for (const v of layout.vessels) m[v.type].add(v.berth);
    return m;
  }, [layout]);

  return (
    <group>
      {/* quay: the shore you stand on, behind the piers */}
      <mesh position={[0, 0.3, 78]} receiveShadow>
        <boxGeometry args={[150, 0.6, 40]} />
        <meshStandardMaterial color={CONCRETE} roughness={0.95} />
      </mesh>
      {PIER_ORDER.map((t) => (
        <Pier key={t} type={t} berths={layout.berthCount[t]} occupied={occupied[t]} />
      ))}
      <Slipway onClick={onSlipway} />
      <Lighthouse />
      <Lock funded={funded} />
      {/* breakwater: the harbour wall, with a sealed second gate for a future chain */}
      <mesh position={[-40, 1.1, -46]}><boxGeometry args={[46, 2.2, 4]} /><meshStandardMaterial color="#0f1822" roughness={1} /></mesh>
      <mesh position={[40, 1.1, -46]}><boxGeometry args={[46, 2.2, 4]} /><meshStandardMaterial color="#0f1822" roughness={1} /></mesh>
      <mesh position={[52, 1.4, -46]}><boxGeometry args={[9, 2.8, 0.5]} /><meshStandardMaterial color="#16222e" metalness={0.5} roughness={0.6} /></mesh>
      <Sign text="SECOND BASIN · SEALED" position={[52, 3.6, -46]} color="#3a4b5c" width={8} fontSize={30} />
    </group>
  );
}
