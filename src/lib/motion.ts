"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Live: toggling the OS setting applies without a reload. Renders as "not reduced" on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}

/** Adds data-in="true" the first time the element scrolls into view. */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.18) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { el.dataset.in = "true"; return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { (e.target as HTMLElement).dataset.in = "true"; io.unobserve(e.target); }
      }),
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return ref;
}

/**
 * One-shot count-up. Under reduced motion, or when disabled, the final value is
 * returned during render rather than animated into place.
 */
export function useCountUp(target: number, ms = 900, enabled = true): number {
  const reduced = useReducedMotion();
  const active = enabled && !reduced;
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min((t - start) / ms, 1);
      setProgress(1 - Math.pow(1 - p, 3)); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, active]);
  return active ? target * progress : target;
}

/** Cycles an index every `ms`, for the word roll. Frozen under reduced motion. */
export function useCycle(length: number, ms = 2200): number {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced || length < 2) return;
    const id = setInterval(() => setN((x) => (x + 1) % length), ms);
    return () => clearInterval(id);
  }, [length, ms, reduced]);
  return reduced ? 0 : n;
}
