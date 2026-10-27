import Link from "next/link";
import { APP_NAME } from "@/src/config/brand";
import { Ember } from "./Ember";

export function SiteHeader() {
  return (
    <header className="no-print border-b-2 border-ink bg-card">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-2xl font-extrabold text-ink no-underline">
          <Ember size={30} />
          {APP_NAME}
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-4">
          <Link href="/venues" className="inline-flex min-h-12 items-center px-2 font-bold text-ink">
            Your venues
          </Link>
          <Link href="/how" className="inline-flex min-h-12 items-center px-2 font-bold text-ink">
            How it works
          </Link>
        </nav>
      </div>
    </header>
  );
}
