import { APP_NAME, TAGLINE } from "@/src/config/brand";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">{TAGLINE}</p>
    </main>
  );
}
