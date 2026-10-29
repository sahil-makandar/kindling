import { REPO_URL } from "@/src/config/brand";

export function SiteFooter() {
  return (
    <footer className="no-print border-t-2 border-rule">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-1 px-4 py-6 text-sm text-ink-soft sm:flex-row sm:justify-between sm:px-6">
        <p>Taste data from Qloo. Map data from OpenStreetMap contributors.</p>
        <p>
          Source code:{" "}
          <a href={REPO_URL} rel="noopener noreferrer">
            {REPO_URL}
          </a>
        </p>
      </div>
    </footer>
  );
}
