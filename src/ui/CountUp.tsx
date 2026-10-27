"use client";

import { useEffect, useRef, useState } from "react";

// A number that counts up from zero when it first shows. Under reduced motion, and on the server, it shows the final value.
export function CountUp({ value, durationMs = 700, suffix = "" }: { value: number; durationMs?: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !Number.isFinite(value)) return;
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return (
    <span>
      <span aria-hidden="true">{shown}{suffix}</span>
      <span className="sr-only">{value}{suffix}</span>
    </span>
  );
}
