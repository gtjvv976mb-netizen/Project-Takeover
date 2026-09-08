"use client";
import { useEffect, useRef } from "react";
import { CameraControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { HarborLayout, Vessel } from "./layout";

export interface RigHandle {
  home: () => void;
  focus: (v: Vessel) => void;
  overview: () => void;
}

/**
 * Chart-table camera over the basin. Clamped so you can never dip under the water,
 * go fully top-down, or drift out of the harbour.
 */
export function Rig({ layout, apiRef }: { layout: HarborLayout; apiRef: React.MutableRefObject<RigHandle | null> }) {
  const controls = useRef<CameraControls>(null);
  const bounds = layout.bounds;
  const aspect = useThree((s) => s.viewport.aspect);
  const portrait = aspect < 1;

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.dollyToCursor = true;
    c.smoothTime = 0.32;
    c.minDistance = 14;
    c.maxDistance = 165;
    c.minPolarAngle = 0.22;
    c.maxPolarAngle = 1.32;
    c.setBoundary(
      new THREE.Box3(
        new THREE.Vector3(bounds.minX - 30, 0, bounds.minZ - 30),
        new THREE.Vector3(bounds.maxX + 30, 0, bounds.maxZ + 30),
      ),
    );
    // portrait screens frame far less width, so pull back and centre the basin
    const home = () => (portrait
      ? c.setLookAt(-34, 62, 150, -2, 0, 34, true)
      : c.setLookAt(-58, 38, 96, -14, 0, 34, true));
    apiRef.current = {
      home,
      overview: () => (portrait
        ? c.setLookAt(-4, 190, 96, -4, 0, 16, true)
        : c.setLookAt(-10, 124, 80, -6, 0, 12, true)),
      focus: (v: Vessel) => {
        const [x, , z] = v.position;
        const k = portrait ? 1.7 : 1;
        // stand off the hull's open water side so the pier never blocks the view,
        // at a distance proportional to the hull so every vessel frames the same
        const side = v.heading === 0 ? -1 : 1;
        const d = (17 + v.scale * 9) * k;
        c.setLookAt(x + side * d * 0.75, 7 + v.scale * 4, z + d, x, 1.6, z, true);
      },
    };
    if (portrait) c.setLookAt(-34, 62, 150, -2, 0, 34, false);
    else c.setLookAt(-58, 38, 96, -14, 0, 34, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, portrait]);

  return <CameraControls ref={controls} makeDefault />;
}
