// studio page. lifts sim + timeIndex state, passes data to all panels
"use client";

import { useMemo, useState, useCallback } from "react";
import TopBar from "@/components/TopBar";
import type { ViewMode } from "@/components/TopBar";
import LeftPanel from "@/components/LeftPanel";
import Viewer from "@/components/Viewer";
import Section2D from "@/components/Section2D";
import ChecksPanel from "@/components/ChecksPanel";
import TimeScrubber from "@/components/TimeScrubber";
import PourWindowTable from "@/components/PourWindowTable";
import {
  generateMockThermalSimulation,
  getPourWindowCandidates,
} from "@/lib/mockThermalField";
import {
  DEFAULT_ELEMENT_CONFIG,
  type ElementConfig,
} from "@/lib/elementConfig";

export default function StudioPage() {
  // sim data lives here so all panels share it
  const sim = useMemo(() => generateMockThermalSimulation(), []);
  const candidates = useMemo(() => getPourWindowCandidates(), []);
  const [timeIndex, setTimeIndex] = useState(0);
  // 2d/3d view toggle from TopBar — both views share scrubber + table
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  // element/mix/pour inputs — single source of truth for LeftPanel + viewers
  const [element, setElement] = useState<ElementConfig>(DEFAULT_ELEMENT_CONFIG);

  // partial update for one config field
  const updateElement = useCallback(
    <K extends keyof ElementConfig>(key: K, value: ElementConfig[K]) => {
      setElement((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

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
      <TopBar viewMode={viewMode} onViewModeChange={setViewMode} />
      <div className="flex flex-1 min-h-0">
        <LeftPanel config={element} onChange={updateElement} />
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {viewMode === "3d" ? (
            <Viewer sim={sim} timeIndex={timeIndex} length_m={element.length_mm / 1000} />
          ) : (
            <Section2D sim={sim} timeIndex={timeIndex} length_m={element.length_mm / 1000} />
          )}
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
