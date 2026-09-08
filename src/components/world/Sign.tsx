"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * A lit harbor sign. Text is baked into a CanvasTexture rather than rendered with
 * troika/SDF text, so nothing fetches a font at runtime and each sign is one quad.
 */
export function Sign({
  text,
  position,
  rotation = [0, 0, 0],
  color = "#ffc27a",
  width = 9,
  fontSize = 44,
  align = "center",
  fadeNear = 46,
  fadeFar = 72,
}: {
  text: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
  width?: number;
  fontSize?: number;
  align?: CanvasTextAlign;
  /** Fully faded below fadeNear, fully lit above fadeFar. */
  fadeNear?: number;
  fadeFar?: number;
}) {
  const { texture, aspect } = useMemo(() => {
    const pad = 28;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = `600 ${fontSize}px ui-monospace, "JetBrains Mono", Menlo, monospace`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = Math.ceil(fontSize * 1.9);
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d")!;
    c.font = font;
    c.textBaseline = "middle";
    c.textAlign = align;
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 18;
    c.fillText(text, align === "center" ? w / 2 : pad, h / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { texture: tex, aspect: w / h };
  }, [text, color, fontSize, align]);

  useEffect(() => () => texture.dispose(), [texture]);

  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const world = useMemo(() => new THREE.Vector3(...position), [position]);
  useFrame(({ camera }) => {
    if (!mat.current || !mesh.current) return;
    const d = camera.position.distanceTo(world);
    const o = THREE.MathUtils.clamp((d - fadeNear) / (fadeFar - fadeNear), 0, 1);
    mat.current.opacity = o;
    mesh.current.visible = o > 0.02;
  });

  return (
    <mesh ref={mesh} position={position} rotation={rotation}>
      <planeGeometry args={[width, width / aspect]} />
      <meshBasicMaterial ref={mat} map={texture} transparent opacity={1} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
