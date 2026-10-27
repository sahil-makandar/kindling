"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { PRESETS, type Preset } from "@/src/runs/presets";
import { NIGHTS, NIGHT_LABEL, VENUE_TYPES, VENUE_TYPE_LABEL, createRunSchema } from "@/src/runs/schema";
import { Button } from "./Button";
import { Card } from "./Card";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

type Fields = { name: string; address: string; venueType: string; slowNight: string; headcount: string };
type Errors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: "", address: "", venueType: "", slowNight: "", headcount: "" };

const control =
  "mt-1 min-h-12 w-full rounded-md border-2 border-ink bg-card px-3 py-2 text-base placeholder:text-ink-soft aria-[invalid=true]:border-tomato";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-bold text-ink">
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 bg-tomato" />
          {error}
        </p>
      )}
    </div>
  );
}

// The venue form. Presets fill it in and carry their own coordinates, so they skip the address lookup.
export function LandingForm() {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [pinned, setPinned] = useState<Preset["input"] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    // Editing the address means the preset's coordinates no longer apply.
    if (key === "address") setPinned(null);
  }

  function applyPreset(preset: Preset) {
    setFields({ name: preset.input.name, address: preset.input.address, venueType: preset.input.venueType, slowNight: preset.input.slowNight, headcount: "" });
    setPinned(preset.input);
    setErrors({});
    setProblem(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);

    const headcount = fields.headcount.trim() === "" ? undefined : Number(fields.headcount);
    const parsed = createRunSchema.safeParse({
      name: fields.name,
      address: fields.address,
      venueType: fields.venueType || undefined,
      slowNight: fields.slowNight || undefined,
      baselineHeadcount: headcount,
      ...(pinned ? { lat: pinned.lat, lon: pinned.lon, matchedAddress: pinned.matchedAddress } : {}),
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === "baselineHeadcount" ? "headcount" : (issue.path[0] as keyof Fields);
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = (await response.json().catch(() => ({}))) as { runId?: string; cached?: boolean; error?: string };
      if (response.ok && body.runId) {
        router.push(`/runs/${body.runId}${body.cached ? "?replay=1" : ""}`);
        return;
      }
      setProblem(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setProblem("We could not reach the server. Check your connection and try again.");
    }
    setSubmitting(false);
  }

  return (
    <Card className="p-6 shadow-hard">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={submitting}>
        <Field id="name" label="Venue name" error={errors.name}>
          <input
            id="name"
            value={fields.name}
            onChange={(e) => set("name", e.target.value)}
            autoComplete="organization"
            maxLength={80}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "name-error" : undefined}
            className={control}
          />
        </Field>
        <Field id="address" label="Address" hint="Street and city, for example 100 Crosby St, New York." error={errors.address}>
          <input
            id="address"
            value={fields.address}
            onChange={(e) => set("address", e.target.value)}
            autoComplete="street-address"
            maxLength={200}
            aria-invalid={!!errors.address}
            aria-describedby={cx("address-hint", errors.address && "address-error")}
            className={control}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="venueType" label="Kind of venue" error={errors.venueType}>
            <select
              id="venueType"
              value={fields.venueType}
              onChange={(e) => set("venueType", e.target.value)}
              aria-invalid={!!errors.venueType}
              aria-describedby={errors.venueType ? "venueType-error" : undefined}
              className={control}
            >
              <option value="">Choose one</option>
              {VENUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VENUE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="slowNight" label="Slowest night" error={errors.slowNight}>
            <select
              id="slowNight"
              value={fields.slowNight}
              onChange={(e) => set("slowNight", e.target.value)}
              aria-invalid={!!errors.slowNight}
              aria-describedby={errors.slowNight ? "slowNight-error" : undefined}
              className={control}
            >
              <option value="">Choose one</option>
              {NIGHTS.map((n) => (
                <option key={n} value={n}>
                  {NIGHT_LABEL[n]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="headcount" label="People on a normal night of that day (optional)" hint="We use this to show how many regulars you have gained." error={errors.headcount}>
          <input
            id="headcount"
            inputMode="numeric"
            value={fields.headcount}
            onChange={(e) => set("headcount", e.target.value.replace(/\D/g, "").slice(0, 4))}
            aria-invalid={!!errors.headcount}
            aria-describedby={cx("headcount-hint", errors.headcount && "headcount-error")}
            className={control}
          />
        </Field>

        {problem && (
          <p role="alert" className="rounded-md border-2 border-tomato bg-card p-3 font-bold">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="cta" disabled={submitting}>
            Find my hidden clubs
          </Button>
          {submitting && <Spinner label="Looking up your address" />}
        </div>
      </form>

      <div className="mt-6 border-t-2 border-rule pt-4">
        <p className="text-sm font-bold">Or try an example venue</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={submitting}
                className="min-h-10 rounded-full border-[1.5px] border-ink bg-card px-4 text-sm font-bold hover:bg-marigold disabled:opacity-50"
              >
                {preset.label}
              </button>
            </li>
          ))}
        </ul>
        {pinned && <p className="mt-3 text-sm text-ink-soft">Example filled in. Change anything you like, then press the button.</p>}
      </div>
    </Card>
  );
}
