"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hullGeometries } from "./hulls";
import { PIER_X, type HarborLayout, type Vessel } from "./layout";
import type { ListingType } from "@/lib/types";

/** How bright a hull sits, by status. Pier colour is mixed in on top. */
const STATUS_LEVEL: Record<string, number> = {
  active: 1,
  paid: 1.15, // money is in the lock; the hull is lit up
  draft: 0.42, // authorities not escrowed yet, so not yet lit
  sold: 0.5,
};
const PAID = new THREE.Color("#ffc27a");
const HULL_BASE = new THREE.Color("#c3d3e2");

const dummy = new THREE.Object3D();
const white = new THREE.Color("#ffffff");

/** One instanced draw call per pier. Hover lives in a ref so a mouse move never re-renders React. */
function Family({
  type,
  vessels,
  hoverRef,
  selectedId,
  dimmedIds,
  onHover,
  onSelect,
}: {
  type: ListingType;
  vessels: Vessel[];
  hoverRef: React.MutableRefObject<{ id: string | null; x: number; y: number }>;
  selectedId: string | null;
  dimmedIds: Set<string> | null;
  onHover: (v: Vessel | null) => void;
  onSelect: (v: Vessel) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => hullGeometries()[type], [type]);
  const hovered = useRef<number>(-1);
  const count = vessels.length;
  const pier = useMemo(() => new THREE.Color(vessels[0]?.color ?? "#ffffff"), [vessels]);

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.18 }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m || !count) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const v = vessels[i];
      const bob = Math.sin(t * 0.85 + v.phase * Math.PI * 2) * 0.09;
      const roll = Math.sin(t * 0.62 + v.phase * Math.PI * 2) * 0.022;
      const lift = i === hovered.current ? 0.22 : 0;
      dummy.position.set(v.position[0], bob + lift, v.position[2]);
      dummy.rotation.set(0, v.heading, roll);
      dummy.scale.setScalar(v.scale * (i === hovered.current ? 1.06 : 1));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      // pale hull washed toward its pier colour, so a glance reads the asset type
      const c = white.copy(HULL_BASE).lerp(pier, 0.62);
      if (v.listing.status === "paid") c.lerp(PAID, 0.55);
      c.multiplyScalar(STATUS_LEVEL[v.listing.status] ?? 1);
      if (dimmedIds?.has(v.listing.id)) c.multiplyScalar(0.22);
      if (v.listing.id === selectedId || i === hovered.current) c.multiplyScalar(1.55);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  if (!count) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[geo, material, count]}
      castShadow
      onPointerMove={(e) => {
        e.stopPropagation();
        const i = e.instanceId ?? -1;
        if (i !== hovered.current) {
          hovered.current = i;
          onHover(i >= 0 ? vessels[i] : null);
          document.body.style.cursor = i >= 0 ? "pointer" : "auto";
        }
        if (i >= 0) {
          hoverRef.current.x = e.clientX;
          hoverRef.current.y = e.clientY;
        }
      }}
      onPointerOut={() => {
        hovered.current = -1;
        onHover(null);
        document.body.style.cursor = "auto";
      }}
      onClick={(e) => {
        e.stopPropagation();
        const i = e.instanceId ?? -1;
        if (i >= 0) onSelect(vessels[i]);
      }}
    />
  );
}

/**
 * Mooring chains. One line per vessel from its bollard to the hull, coloured by
 * pier. A lit chain means the wallet's ownership was verified on-chain; a draft
 * listing (authorities not yet escrowed) gets a slack, unlit rope instead.
 */
function Chains({ vessels }: { vessels: Vessel[] }) {
  const { geometry, material } = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const v of vessels) {
      const lit = v.listing.status !== "draft";
      c.set(lit ? v.color : "#3d4a57");
      const bollardX = PIER_X[v.type] + (v.berth % 2 === 0 ? -2.4 : 2.4);
      const [hx, , hz] = v.position;
      // two mooring lines, bow and stern
      for (const dz of [-2.0, 2.0]) {
        pos.push(bollardX, 0.95, v.position[2] + dz * 0.5, hx, 0.75, hz + dz);
        for (let k = 0; k < 2; k++) col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return { geometry: g, material: new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }) };
  }, [vessels]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  if (!vessels.length) return null;
  return <lineSegments geometry={geometry} material={material} />;
}

/** Sold projects, moored out past the breakwater. A visible track record. */
function Anchorage({ layout }: { layout: HarborLayout }) {
  const geo = useMemo(() => hullGeometries().token_authority, []);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const n = layout.anchorage.length;
  useEffect(() => {
    const m = mesh.current;
    if (!m || !n) return;
    layout.anchorage.forEach((a, i) => {
      dummy.position.set(a.position[0], 0, a.position[2]);
      dummy.rotation.set(0, Math.PI * 0.5 + i * 0.3, 0);
      dummy.scale.setScalar(a.scale);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [layout, n]);
  if (!n) return null;
  return (
    <instancedMesh ref={mesh} args={[geo, undefined, n]}>
      <meshBasicMaterial color="#4a5f73" transparent opacity={0.55} />
    </instancedMesh>
  );
}

/** A ring of light on the water under the selected vessel. */
function SelectionRing({ vessel }: { vessel: Vessel | null }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.05;
      ring.current.scale.setScalar(s);
    }
  });
  if (!vessel) return null;
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[vessel.position[0], 0.07, vessel.position[2]]}>
      <ringGeometry args={[3.1, 3.5, 40]} />
      <meshBasicMaterial color={vessel.color} transparent opacity={0.85} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

export function Fleet({
  layout,
  hoverRef,
  selected,
  dimmedIds,
  onHover,
  onSelect,
}: {
  layout: HarborLayout;
  hoverRef: React.MutableRefObject<{ id: string | null; x: number; y: number }>;
  selected: Vessel | null;
  dimmedIds: Set<string> | null;
  onHover: (v: Vessel | null) => void;
  onSelect: (v: Vessel) => void;
}) {
  const byType = useMemo(() => {
    const m: Record<ListingType, Vessel[]> = { token_authority: [], pump_creator: [], offchain: [] };
    for (const v of layout.vessels) m[v.type].push(v);
    return m;
  }, [layout]);

  return (
    <group>
      {(Object.keys(byType) as ListingType[]).map((t) => (
        <Family
          key={t}
          type={t}
          vessels={byType[t]}
          hoverRef={hoverRef}
          selectedId={selected?.listing.id ?? null}
          dimmedIds={dimmedIds}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
      <Chains vessels={layout.vessels} />
      <Anchorage layout={layout} />
      <SelectionRing vessel={selected} />
    </group>
  );
}
