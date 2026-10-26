"use client";

import { useState } from "react";
import { Button } from "@/src/ui/Button";
import { Drawer } from "@/src/ui/Drawer";
import { ScoreBar } from "@/src/ui/ScoreBar";

export function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open the drawer
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="How we know">
        <p className="mb-4 text-ink-soft">
          Each score bar opens the exact Qloo calls behind it.
        </p>
        <ScoreBar label="Local affinity" value={0.82} onSelect={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
