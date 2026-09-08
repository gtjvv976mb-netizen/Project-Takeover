"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Cheap harbor water: two crossed swells, a horizon gradient and sodium-light glints. */
export function Water({ size = 420, onClick }: { size?: number; onClick?: () => void }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color("#03070e") },
      uShallow: { value: new THREE.Color("#0e2436") },
      uGlint: { value: new THREE.Color("#ffc27a") },
    }),
    [],
  );
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} onClick={onClick}>
      <planeGeometry args={[size, size, 96, 96]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          varying vec3 vPos;
          varying float vChop;
          void main() {
            vec3 p = position;
            // slow swell shapes the surface
            float swell = sin(p.x * 0.16 + uTime * 0.55) * 0.13
                        + sin(p.y * 0.21 - uTime * 0.42) * 0.10;
            // fast chop makes the small crests that catch the dock lights
            float chop = sin(p.x * 1.35 + uTime * 1.9) * 0.5
                       + sin(p.y * 1.61 - uTime * 1.55) * 0.5
                       + sin((p.x - p.y) * 0.97 + uTime * 1.2) * 0.4;
            p.z += swell + chop * 0.05;
            vChop = chop;
            vPos = p;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uGlint; uniform float uTime;
          varying vec3 vPos; varying float vChop;
          void main() {
            float d = clamp(length(vPos.xy) / 190.0, 0.0, 1.0);
            vec3 col = mix(uShallow, uDeep, d * d);
            // only the sharpest chop crests catch light, so glints stay small and bright
            float crest = smoothstep(1.05, 1.32, vChop);
            col += uGlint * crest * 0.30 * (1.0 - d);
            // a broad wash of lamp light over the basin, brightest near the piers
            float lane = exp(-pow((vPos.y - 26.0) * 0.014, 2.0));
            col += uGlint * lane * 0.045;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `}
      />
    </mesh>
  );
}
