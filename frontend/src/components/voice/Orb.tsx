"use client";

// Audio-reactive orb: breathes with the mic while listening, blooms with the
// agent's voice while speaking, and swirls while tools/thinking are running.

import { useEffect, useRef } from "react";

export type OrbMode = "idle" | "connecting" | "listening" | "speaking" | "thinking";

const PALETTE: Record<OrbMode, [string, string]> = {
  idle: ["#cbd5e1", "#94a3b8"],
  connecting: ["#fde68a", "#f59e0b"],
  listening: ["#6ee7b7", "#059669"],
  speaking: ["#5eead4", "#7c3aed"],
  thinking: ["#c4b5fd", "#f59e0b"],
};

export function Orb({ mode, levelRef, size = 176 }: { mode: OrbMode; levelRef: React.MutableRefObject<number>; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    let raf = 0;
    let smooth = 0;
    const t0 = performance.now();

    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const m = modeRef.current;
      const target = m === "thinking" ? 0.25 + 0.1 * Math.sin(t * 3) : Math.min(levelRef.current * 6, 1);
      smooth += (target - smooth) * 0.18;
      const [c1, c2] = PALETTE[m];
      const cx = size / 2, cy = size / 2;
      const base = size * 0.28;
      ctx.clearRect(0, 0, size, size);

      // soft glow
      const glow = ctx.createRadialGradient(cx, cy, base * 0.6, cx, cy, size / 2);
      glow.addColorStop(0, c1 + "55");
      glow.addColorStop(1, c1 + "00");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, base * (1.25 + smooth * 0.5), 0, Math.PI * 2);
      ctx.fill();

      // wobbling blob
      const pts = 96;
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob =
          Math.sin(a * 3 + t * 1.7) * 0.05 + Math.sin(a * 5 - t * 2.3) * 0.035 + Math.sin(a * 2 + t * 0.9) * 0.04;
        const r = base * (1 + smooth * 0.35 + wob * (0.4 + smooth * 1.6) + (m === "idle" ? Math.sin(t * 1.2) * 0.02 : 0));
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const rot = m === "thinking" ? t * 2 : t * 0.4;
      const grad = ctx.createLinearGradient(
        cx + Math.cos(rot) * base, cy + Math.sin(rot) * base, cx - Math.cos(rot) * base, cy - Math.sin(rot) * base);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.fill();

      // specular highlight
      const hl = ctx.createRadialGradient(cx - base * 0.35, cy - base * 0.4, 2, cx - base * 0.35, cy - base * 0.4, base * 0.8);
      hl.addColorStop(0, "rgba(255,255,255,0.55)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, levelRef]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} aria-label={`Voice assistant ${mode}`} />;
}
