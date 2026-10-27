"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Copies text to the clipboard and says so for a moment. If the browser refuses, it says that instead.
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="no-print inline-flex min-h-10 items-center gap-2 rounded-md border-2 border-ink bg-card px-3 text-sm font-bold hover:bg-marigold"
    >
      {state === "copied" ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={16} strokeWidth={1.75} aria-hidden="true" />}
      <span role="status">{state === "copied" ? "Copied" : state === "failed" ? "Could not copy, select the text instead" : label}</span>
    </button>
  );
}
