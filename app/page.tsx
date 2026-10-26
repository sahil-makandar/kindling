import { APP_NAME, TAGLINE } from "@/src/config/brand";

export default function Home() {
  return (
    <div className="flex max-w-2xl flex-col gap-4 py-16">
      <h1 className="text-[2.75rem]">{APP_NAME}</h1>
      <p className="text-lg text-ink-soft">{TAGLINE}</p>
    </div>
  );
}
