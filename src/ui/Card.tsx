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
    <div className={cx("rounded-lg border-2 border-ink bg-card p-5 shadow-hard", className)}>
      {children}
    </div>
  );
}
