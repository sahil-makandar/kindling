"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

// Slides in from the right. Uses a native modal <dialog>, so focus is trapped
// and Escape closes it without extra code.
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="drawer overflow-y-auto border-l-2 border-ink bg-card p-0 text-ink"
    >
      <div className="flex items-center justify-between border-b-2 border-rule p-5">
        <h2 className="text-2xl">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-12 w-12 items-center justify-center rounded-md border-2 border-ink"
        >
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
