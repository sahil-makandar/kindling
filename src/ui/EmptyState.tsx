import type { ReactNode } from "react";

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border-2 border-dashed border-ink-soft bg-card p-8 text-center">
      <h3 className="text-2xl">{title}</h3>
      {children && <p className="mx-auto mt-2 max-w-[68ch] text-ink-soft">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
