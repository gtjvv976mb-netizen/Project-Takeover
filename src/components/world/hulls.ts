// Three procedural hulls, one per asset type. Each is merged into a single
// BufferGeometry so a whole pier renders as one instanced draw call.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ListingType } from "@/lib/types";

/** Deck plan: pointed bow at +Z, square stern at -Z. Extruded down into a hull. */
function hullBody(len: number, beam: number, depth: number, bowSharpness: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const half = beam / 2;
  s.moveTo(-half, -len / 2);
  s.lineTo(half, -len / 2);
  s.lineTo(half, len / 2 - len * bowSharpness);
  s.quadraticCurveTo(half, len / 2, 0, len / 2);
  s.quadraticCurveTo(-half, len / 2, -half, len / 2 - len * bowSharpness);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: beam * 0.14, bevelThickness: depth * 0.3, bevelSegments: 2, curveSegments: 6 });
  // Extrude builds on XY facing +Z; stand it up so length runs along Z and depth along Y.
  g.rotateX(-Math.PI / 2);
  g.translate(0, depth, 0);
  return g;
}

/**
 * ExtrudeGeometry is non-indexed while Box/Cylinder are indexed, and mergeGeometries
 * refuses to mix the two. Flatten everything to non-indexed before merging.
 */
function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

/** Merge, or fall back to a plain hull block so a bad merge can never blank the scene. */
function weld(parts: THREE.BufferGeometry[], fallbackLen: number, fallbackBeam: number): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map(flat));
  if (merged) return merged;
  console.warn("[harbor] hull merge failed; using fallback block");
  return new THREE.BoxGeometry(fallbackBeam, 1.2, fallbackLen);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function mast(h: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.06, 0.09, h, 5);
  g.translate(0, h / 2, z);
  return g;
}

/**
 * token_authority — a CUTTER: low, sharp, fast. Authorities are the sharpest,
 * most surgical thing you can sell, and it settles in one atomic transaction.
 */
function cutter(): THREE.BufferGeometry {
  return weld([
    hullBody(7.4, 2.0, 0.62, 0.34),
    box(1.25, 0.5, 2.0, 0, 0.86, -0.5),
    box(0.9, 0.34, 1.1, 0, 1.28, -0.35),
    mast(2.5, 0.7),
  ], 7.4, 2.0);
}

/**
 * pump_creator — a FREIGHTER: long, stacked, carrying cargo that is not its own.
 * The creator role is a berth on someone else's bonding curve.
 */
function freighter(): THREE.BufferGeometry {
  const cargo: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) cargo.push(box(1.7, 0.52, 1.15, 0, 0.94, 1.9 - i * 1.35));
  for (let i = 0; i < 2; i++) cargo.push(box(1.15, 0.5, 1.0, 0, 1.44, 1.5 - i * 1.3));
  return weld([
    hullBody(9.6, 2.6, 0.68, 0.24),
    ...cargo,
    box(2.1, 1.15, 1.5, 0, 1.24, -3.3),
    box(1.4, 0.42, 0.9, 0, 1.99, -3.3),
    mast(2.0, -4.1),
  ], 9.6, 2.6);
}

/**
 * offchain — a TUG: stout, high-bridged, all superstructure. A whole project is
 * mostly the things standing above the waterline: site, community, code.
 */
function tug(): THREE.BufferGeometry {
  return weld([
    hullBody(6.2, 2.7, 0.8, 0.3),
    box(2.2, 1.35, 2.4, 0, 1.44, -0.7),
    box(1.7, 1.05, 1.6, 0, 2.62, -0.6),
    box(1.15, 0.42, 1.0, 0, 3.32, -0.55),
    mast(1.8, -1.5),
    box(0.34, 0.34, 1.5, 0, 0.9, 2.3),
  ], 6.2, 2.7);
}

let cache: Record<ListingType, THREE.BufferGeometry> | null = null;

export function hullGeometries(): Record<ListingType, THREE.BufferGeometry> {
  if (!cache) {
    cache = { token_authority: cutter(), pump_creator: freighter(), offchain: tug() };
    for (const g of Object.values(cache)) {
      g.computeVertexNormals();
      g.computeBoundingSphere();
    }
  }
  return cache;
}

/** A flat dashed outline of a hull, drawn on the water at every empty berth. */
export function berthOutline(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const len = 7.0, half = 1.2;
  const add = (x: number, z: number) => pts.push(new THREE.Vector3(x, 0, z));
  add(-half, -len / 2); add(half, -len / 2); add(half, len / 2 - 1.6);
  add(0, len / 2); add(-half, len / 2 - 1.6); add(-half, -len / 2);
  return new THREE.BufferGeometry().setFromPoints(pts);
}
