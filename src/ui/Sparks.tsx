"use client";

import { useEffect, useState } from "react";

const DOTS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const reach = 34 + (i % 3) * 14;
  return { dx: Math.round(Math.cos(angle) * reach), dy: Math.round(Math.sin(angle) * reach), color: i % 2 ? "#FFC845" : "#FF6B35", size: 5 + (i % 3) * 2 };
});

// A short burst of ember and sunflower dots from the middle of its parent. It plays once when it mounts, then removes itself.
// Put it inside a `relative` element.
export function SparkBurst({ className = "" }: { className?: string }) {
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setAlive(false), 900);
    return () => clearTimeout(t);
  }, []);
  if (!alive) return null;
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute left-1/2 top-1/2 z-10 h-0 w-0 motion-reduce:hidden ${className}`}>
      {DOTS.map((d, i) => (
        <span
          key={i}
          className="absolute animate-spark rounded-full"
          style={{ width: d.size, height: d.size, background: d.color, marginLeft: -d.size / 2, marginTop: -d.size / 2, ["--dx" as string]: `${d.dx}px`, ["--dy" as string]: `${d.dy}px` }}
        />
      ))}
    </span>
  );
}
