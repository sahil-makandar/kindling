import type { ReactNode } from "react";

// Every page opens with what it is, in one line, and the one thing to do next.
export function PageIntro({ title, children, action, aside }: { title: string; children: ReactNode; action?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="no-print mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-[62ch]">
        <h1 className="text-[2rem] sm:text-[2.5rem]">{title}</h1>
        <p className="mt-2 text-lg text-ink-soft">{children}</p>
        {aside}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
