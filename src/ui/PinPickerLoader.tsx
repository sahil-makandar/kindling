"use client";

import dynamic from "next/dynamic";
import { Spinner } from "./Spinner";

// Leaflet touches window, so the picker only loads in the browser.
export const PinPickerView = dynamic(() => import("./PinPicker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 w-full items-center justify-center bg-paper">
      <Spinner label="Loading the map" />
    </div>
  ),
});
