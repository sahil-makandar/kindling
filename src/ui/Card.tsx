import type { ReactNode } from "react";
import { cx } from "./cx";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rounded-md border-2 border-ink bg-card p-5", className)}>
      {children}
    </div>
  );
}
