// studio page. lifts sim + timeIndex state, passes data to all panels
"use client";

import { useMemo, useState, useCallback } from "react";
import TopBar from "@/components/TopBar";
import LeftPanel from "@/components/LeftPanel";
import Viewer from "@/components/Viewer";
import ChecksPanel from "@/components/ChecksPanel";
import TimeScrubber from "@/components/TimeScrubber";
import PourWindowTable from "@/components/PourWindowTable";
import {
  generateMockThermalSimulation,
  getPourWindowCandidates,
} from "@/lib/mockThermalField";

export default function StudioPage() {
  // sim data lives here so all panels share it
  const sim = useMemo(() => generateMockThermalSimulation(), []);
  const candidates = useMemo(() => getPourWindowCandidates(), []);
  const [timeIndex, setTimeIndex] = useState(0);

  // snap slider value to nearest time step index
  const handleTimeChange = useCallback(
    (time_h: number) => {
      const idx = Math.round(time_h / 0.5);
      setTimeIndex(Math.max(0, Math.min(idx, sim.times_h.length - 1)));
    },
    [sim.times_h.length]
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <LeftPanel />
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <Viewer sim={sim} timeIndex={timeIndex} />
          <TimeScrubber
            times_h={sim.times_h}
            timeIndex={timeIndex}
            onTimeChange={handleTimeChange}
          />
          <PourWindowTable candidates={candidates} />
        </div>
        <ChecksPanel flags={sim.flags} />
      </div>
    </div>
  );
}
