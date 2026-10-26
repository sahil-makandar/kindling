import Link from "next/link";
import { APP_NAME } from "@/src/config/brand";

export function SiteHeader() {
  return (
    <header className="no-print border-b-2 border-ink bg-card">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-2xl text-ink no-underline">
          {APP_NAME}
        </Link>
        <nav aria-label="Main">
          <Link href="/how" className="inline-flex min-h-12 items-center font-bold">
            How it works
          </Link>
        </nav>
      </div>
    </header>
  );
}
