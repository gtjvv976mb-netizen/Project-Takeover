"use client";
import { useEffect, useRef } from "react";

/** Soft themed glow that trails the pointer. Pure DOM, negligible cost. */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let x = window.innerWidth / 2, y = window.innerHeight / 2, tx = x, ty = y, raf = 0;
    const move = (e: PointerEvent) => { tx = e.clientX; ty = e.clientY; };
    const tick = () => { x += (tx - x) * 0.12; y += (ty - y) * 0.12; el.style.transform = `translate(${x - 200}px, ${y - 200}px)`; raf = requestAnimationFrame(tick); };
    window.addEventListener("pointermove", move, { passive: true }); raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[5] h-[400px] w-[400px] rounded-full opacity-40 blur-3xl" style={{ background: "radial-gradient(circle, rgba(255,106,61,0.35) 0%, rgba(184,240,74,0.15) 40%, transparent 70%)" }} />;
}
