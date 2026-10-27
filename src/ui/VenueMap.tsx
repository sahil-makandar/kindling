"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { COLORS } from "@/src/config/brand";

export type HeatPoint = { lat: number; lon: number; affinity?: number };

// OpenStreetMap tiles with the attribution the tile policy asks for, left visible bottom right.
// Venue pin: ink circle with a tomato centre. Scan radius: ink-blue dashed circle with a light fill.
// Heat points: tomato dots, more opaque where taste affinity is higher.
export default function VenueMap({
  lat,
  lon,
  radiusM,
  heat = [],
  label,
}: {
  lat: number;
  lon: number;
  radiusM: number;
  heat?: HeatPoint[];
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const layers = useRef<{ map: L.Map; circle: L.Circle; heat: L.LayerGroup } | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const map = L.map(element, { scrollWheelZoom: false, zoomControl: true }).setView([lat, lon], 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const pin = L.divIcon({
      className: "",
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      html: `<span style="display:block;width:22px;height:22px;border-radius:9999px;background:${COLORS.ink};box-shadow:0 0 0 2px ${COLORS.card};position:relative"><span style="position:absolute;inset:6px;border-radius:9999px;background:${COLORS.tomato}"></span></span>`,
    });
    L.marker([lat, lon], { icon: pin, title: label, keyboard: false }).addTo(map);

    const circle = L.circle([lat, lon], { radius: radiusM, color: COLORS.emberInk, weight: 2, dashArray: "6 6", fillColor: COLORS.tomato, fillOpacity: 0.08 }).addTo(map);
    const heatLayer = L.layerGroup().addTo(map);
    layers.current = { map, circle, heat: heatLayer };
    map.fitBounds(circle.getBounds(), { padding: [16, 16] });

    return () => {
      map.remove();
      layers.current = null;
    };
    // The map is built once per venue; radius and heat are updated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, label]);

  useEffect(() => {
    const current = layers.current;
    if (!current) return;
    current.circle.setRadius(radiusM);
    current.map.fitBounds(current.circle.getBounds(), { padding: [16, 16], animate: false });
  }, [radiusM]);

  useEffect(() => {
    const current = layers.current;
    if (!current) return;
    current.heat.clearLayers();
    for (const point of heat) {
      const weight = Math.min(1, Math.max(0.15, point.affinity ?? 0.5));
      L.circleMarker([point.lat, point.lon], { radius: 4 + weight * 6, stroke: false, fillColor: COLORS.tomato, fillOpacity: 0.25 + weight * 0.55, interactive: false }).addTo(current.heat);
    }
  }, [heat]);

  return <div ref={container} role="group" aria-label={label} className="h-full w-full bg-paper" />;
}
