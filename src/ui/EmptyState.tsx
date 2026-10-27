import type { ReactNode } from "react";
import { Ember, type EmberMood } from "./Ember";

export function EmptyState({
  title,
  children,
  action,
  mood = "waving",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  mood?: EmberMood;
}) {
  return (
    <div className="rounded-lg border-2 border-dashed border-ink-soft bg-card p-8 text-center">
      <div className="flex justify-center">
        <Ember mood={mood} size={72} />
      </div>
      <h3 className="mt-2 text-2xl">{title}</h3>
      {children && <p className="mx-auto mt-2 max-w-[68ch] text-ink-soft">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
