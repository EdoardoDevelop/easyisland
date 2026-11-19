// Surface contrast and transparency policy for Dock and overlays.

import type { DockLook } from "../core/state";

/** Detects OS "Reduce transparency" preference via CSS media query or DOM attribute. */
export function prefersReducedTransparency(): boolean {
  if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-reduce-transparency")) {
    return true;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
  }
  return false;
}

/** Subscribes to live OS "Reduce transparency" changes; returns cleanup callback. */
export function onReducedTransparencyChange(cb: (reduced: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-reduced-transparency: reduce)");
  const onChange = () => cb(mq.matches);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

/** Returns true when Dock surfaces must render solid high-contrast fills instead of glass blur. */
export function isSurfaceOpaque(explicitReduceTransparency: boolean): boolean {
  return !!explicitReduceTransparency || prefersReducedTransparency();
}

/** Resolves effective background opacity (0..1) from DockLook settings and opaque accessibility state. */
export function effectiveSurfaceAlpha(look: DockLook, opaque: boolean): number {
  if (opaque) return 1;
  if (typeof look.opacity === "number") {
    return Math.max(0.15, Math.min(1, look.opacity / 100));
  }
  const strength = Math.max(0, Math.min(100, Number(look.materialStrength ?? 65))) / 100;
  return Math.round((0.42 + strength * 0.46) * 100) / 100;
}
