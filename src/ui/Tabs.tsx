"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type TabItem = { id: string; label: string; content: ReactNode };

// Text tabs with a marigold underline on the active one. Arrow keys, Home and End move focus.
export function Tabs({
  tabs,
  initialId,
  className,
}: {
  tabs: TabItem[];
  initialId?: string;
  className?: string;
}) {
  const [activeId, setActiveId] = useState(initialId ?? tabs[0]?.id);
  const baseId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setActiveId(tabs[next].id);
    buttons.current[next]?.focus();
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b-2 border-rule">
        {tabs.map((tab, i) => {
          const selected = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cx(
                "-mb-0.5 min-h-12 whitespace-nowrap border-b-4 px-4 py-2",
                selected ? "border-marigold font-bold" : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          className="pt-5"
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
