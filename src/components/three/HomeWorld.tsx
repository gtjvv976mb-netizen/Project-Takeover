"use client";
import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import type { Listing } from "@/lib/types";
import { BG, PURPLE, STATION_GAP, damp } from "./palette";
import { Core, Orbit } from "./Orbit";
import { Forge, Scanner, Vault } from "./Stations";

const STATIONS = 4; // orbit, forge, scanner, vault

/** Camera flies down through the stations as the page scrolls; mouse adds parallax. */
function Rig({ tRef }: { tRef: React.MutableRefObject<number> }) {
  const look = useRef(new THREE.Vector3(0, 0, 0));
  useEffect(() => {
    const onScroll = () => { tRef.current = THREE.MathUtils.clamp(window.scrollY / window.innerHeight, 0, STATIONS - 1); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [tRef]);
  useFrame(({ camera, pointer }, dt) => {
    const t = tRef.current;
    const i = Math.round(t);
    const x = i === 0 ? 0 : 3; // stations 1..3 sit right of the copy
    const targetY = -t * STATION_GAP;
    const px = pointer.x * 1.2, py = pointer.y * 0.8;
    camera.position.x = damp(camera.position.x, x + px + Math.sin(t * 1.7) * 2.5, 3, dt);
    camera.position.y = damp(camera.position.y, targetY + 3.5 + py, 3, dt);
    camera.position.z = damp(camera.position.z, 17 - Math.min(t, 1) * 3, 3, dt);
    look.current.set(damp(look.current.x, x, 3, dt), damp(look.current.y, targetY, 3, dt), 0);
    camera.lookAt(look.current);
  });
  return null;
}

export default function HomeWorld({ listings }: { listings: Listing[] }) {
  const tRef = useRef(0);
  return (
    <div className="fixed inset-0 z-0">
      <Canvas camera={{ position: [0, 5, 17], fov: 50 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 20, 48]} />
        <ambientLight intensity={0.35} />
        <Stars radius={90} depth={60} count={4000} factor={3} fade speed={0.5} />
        <Rig tRef={tRef} />
        <group position={[0, 0, 0]}><Core /><Orbit listings={listings} /></group>
        <group position={[3, -STATION_GAP, 0]}><Forge tRef={tRef} index={1} /></group>
        <group position={[3, -STATION_GAP * 2, 0]}><Scanner tRef={tRef} index={2} /></group>
        <group position={[3, -STATION_GAP * 3, 0]}><Vault tRef={tRef} index={3} /></group>
        {/* faint vertical "warp" line connecting stations */}
        <mesh position={[3, -STATION_GAP * 1.5, -6]}><cylinderGeometry args={[0.02, 0.02, STATION_GAP * 3.4, 6]} /><meshBasicMaterial color={PURPLE} transparent opacity={0.25} /></mesh>
      </Canvas>
    </div>
  );
}
