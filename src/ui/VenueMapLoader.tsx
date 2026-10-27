"use client";

import dynamic from "next/dynamic";
import type { HeatPoint } from "./VenueMap";
import { Spinner } from "./Spinner";

// Leaflet touches window, so the map only loads in the browser.
const VenueMap = dynamic(() => import("./VenueMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-paper">
      <Spinner label="Loading the map" />
    </div>
  ),
});

export function VenueMapView(props: { lat: number; lon: number; radiusM: number; heat?: HeatPoint[]; label: string; className?: string }) {
  const { className, ...map } = props;
  return (
    <div className={className ?? "h-full w-full"}>
      <VenueMap {...map} />
    </div>
  );
}
