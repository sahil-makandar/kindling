"use client";

import { useEffect } from "react";
import { remember } from "@/src/progress/remember";

// Saves this venue in the browser so "Your venues" can list it. Renders nothing.
export function RememberVenue(props: { venueName: string; venueType: string; slowNight: string; runId: string | null; clubId: string | null; clubTitle: string | null }) {
  const { venueName, venueType, slowNight, runId, clubId, clubTitle } = props;
  useEffect(() => {
    // One entry per venue run. A club made from the run updates the same entry.
    remember({ key: runId ?? clubId ?? venueName, venueName, venueType, slowNight, runId, clubId, clubTitle });
  }, [venueName, venueType, slowNight, runId, clubId, clubTitle]);
  return null;
}
