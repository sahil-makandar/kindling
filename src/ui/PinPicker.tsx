"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { COLORS } from "@/src/config/brand";

export type Pin = { lat: number; lon: number };

const icon = () =>
  L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span style="display:block;width:22px;height:22px;border-radius:9999px;background:${COLORS.ink};box-shadow:0 0 0 2px ${COLORS.card};position:relative"><span style="position:absolute;inset:6px;border-radius:9999px;background:${COLORS.tomato}"></span></span>`,
  });

// Click the map to drop the venue's pin. Used when the address could not be found. OpenStreetMap tiles, with attribution.
export default function PinPicker({ pin, onPick }: { pin: Pin | null; onPick: (pin: Pin) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef<{ map: L.Map; marker: L.Marker | null } | null>(null);
  const handler = useRef(onPick);

  useEffect(() => {
    handler.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const map = L.map(element, { scrollWheelZoom: false }).setView([39.8, -98.6], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    state.current = { map, marker: null };
    map.on("click", (event: L.LeafletMouseEvent) => handler.current({ lat: event.latlng.lat, lon: event.latlng.lng }));
    return () => {
      map.remove();
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const current = state.current;
    if (!current || !pin) return;
    if (current.marker) current.marker.setLatLng([pin.lat, pin.lon]);
    else current.marker = L.marker([pin.lat, pin.lon], { icon: icon(), keyboard: false }).addTo(current.map);
  }, [pin]);

  return <div ref={container} role="application" aria-label="Map. Click where your venue is." className="h-72 w-full bg-paper" />;
}
