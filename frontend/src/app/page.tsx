// studio page. lifts sim + timeIndex + viewMode + element state, hosts toggleable palettes
"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import TopBar from "@/components/TopBar";
import type { ViewMode } from "@/components/TopBar";
import LeftPanel from "@/components/LeftPanel";
import Viewer from "@/components/Viewer";
import Section2D from "@/components/Section2D";
import ChecksPanel from "@/components/ChecksPanel";
import TimeScrubber from "@/components/TimeScrubber";
import PourWindowTable from "@/components/PourWindowTable";
import FloatingPanel from "@/components/FloatingPanel";
import type { PanelGeometry } from "@/components/FloatingPanel";
import type { PanelId } from "@/components/PanelId";
import {
  generateMockThermalSimulation,
  getPourWindowCandidates,
  createGridFromOutline,
  type GridData,
} from "@/lib/mockThermalField";
import {
  DEFAULT_ELEMENT_CONFIG,
  type ElementConfig,
} from "@/lib/elementConfig";
import { importIfcOutline } from "@/lib/ifcImport";
import { IMPORTED_SHAPE, type IfcUiState } from "@/components/LeftPanel";
import type { LengthUnit } from "@/lib/units";

// where each palette opens before first drag/resize
const PANEL_GEO: Record<PanelId, PanelGeometry & { minW: number; minH: number }> = {
  element: { x: 16, y: 16, w: 262, h: 480, minW: 262, minH: 240 },
  checks: { x: 950, y: 16, w: 282, h: 520, minW: 282, minH: 240 },
  pour: { x: 16, y: 320, w: 640, h: 280, minW: 480, minH: 200 },
};

// imported element geometry, null = preset shapes only
interface ImportedElement {
  outline: [number, number][];
  length_m: number;
  name: string;
}

export default function StudioPage() {
  // imported IFC geometry + import ui state
  const [imported, setImported] = useState<ImportedElement | null>(null);
  const [ifcUi, setIfcUi] = useState<IfcUiState>({ busy: false, error: null, name: null });
  // element/mix/pour inputs — single source of truth for LeftPanel + viewers
  const [element, setElement] = useState<ElementConfig>(DEFAULT_ELEMENT_CONFIG);

  // sim data lives here so all panels share it; imported outline runs same pipeline
  const grid: GridData | undefined = useMemo(
    () => (imported ? createGridFromOutline(imported.outline) : undefined),
    [imported]
  );
  const sim = useMemo(() => generateMockThermalSimulation(grid), [grid]);
  const candidates = useMemo(() => getPourWindowCandidates(), []);
  const [timeIndex, setTimeIndex] = useState(0);
  // 2d/3d view toggle from TopBar — both views share scrubber + table
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  // palettes all closed on load — viewer gets clean canvas
  const [openPanels, setOpenPanels] = useState<Record<PanelId, boolean>>({
    element: false,
    checks: false,
    pour: false,
  });
  // dimension display unit — canonical state stays SI, this is display only
  const [units, setUnits] = useState<LengthUnit>("m");

  // partial update for one config field; preset pick clears any IFC import
  const updateElement = useCallback(
    <K extends keyof ElementConfig>(key: K, value: ElementConfig[K]) => {
      if (key === "shape" && value !== IMPORTED_SHAPE) {
        setImported(null);
        setIfcUi({ busy: false, error: null, name: null });
      }
      setElement((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // run ifc import from raw bytes — shared by file picker and ?ifc= loader
  const runImport = useCallback(async (data: ArrayBuffer, fileName: string) => {
    setIfcUi({ busy: true, error: null, name: null });
    // surface feedback: element palette must be open to see status/errors
    setOpenPanels((prev) => ({ ...prev, element: true }));
    const outcome = await importIfcOutline(data);
    if (!outcome.ok) {
      setIfcUi({ busy: false, error: `${fileName}: ${outcome.error}`, name: null });
      return;
    }
    const el = outcome.element;
    setImported({ outline: el.outline, length_m: el.length_m, name: el.name });
    // reflect section bbox + length in shared config so units/labels stay honest
    const w = Math.max(...el.outline.map((p) => p[0]));
    const h = Math.max(...el.outline.map((p) => p[1]));
    setElement((prev) => ({
      ...prev,
      shape: IMPORTED_SHAPE,
      flange_width_mm: w * 1000,
      total_depth_mm: h * 1000,
      length_mm: el.length_m * 1000,
    }));
    setIfcUi({ busy: false, error: null, name: el.name });
  }, []);

  // file picker entry point
  const handleImportIfc = useCallback(
    (file: File) => {
      file.arrayBuffer().then((buf) => runImport(buf, file.name));
    },
    [runImport]
  );

  // dev/demo loader: ?ifc=/samples/tbeam.ifc fetches and imports on mount
  useEffect(() => {
    const url = new URL(window.location.href).searchParams.get("ifc");
    if (!url) return;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => runImport(buf, url))
      .catch((e) => setIfcUi({ busy: false, error: `${url}: ${String(e)}`, name: null }));
    // run once per mount; runImport stable
  }, [runImport]);

  // snap slider value to nearest time step index
  const handleTimeChange = useCallback(
    (time_h: number) => {
      const idx = Math.round(time_h / 0.5);
      setTimeIndex(Math.max(0, Math.min(idx, sim.times_h.length - 1)));
    },
    [sim.times_h.length]
  );

  // toggle one palette open/closed from TopBar launcher
  const togglePanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // close one palette from its X button
  const closePanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => ({ ...prev, [id]: false }));
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        openPanels={openPanels}
        onTogglePanel={togglePanel}
        units={units}
        onUnitsChange={setUnits}
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* viewer area — palettes float on top of this, never reflow it */}
          <div className="flex-1 relative flex min-h-0">
            {viewMode === "3d" ? (
              <Viewer sim={sim} timeIndex={timeIndex} length_m={element.length_mm / 1000} units={units} />
            ) : (
              <Section2D sim={sim} timeIndex={timeIndex} length_m={element.length_mm / 1000} units={units} />
            )}

            {/* floating palettes overlay — pass clicks through to viewer elsewhere */}
            <div className="absolute inset-0 pointer-events-none">
              {openPanels.element && (
                <FloatingPanel
                  title="Element & Mix Inputs"
                  defaultGeo={PANEL_GEO.element}
                  minWidth={PANEL_GEO.element.minW}
                  minHeight={PANEL_GEO.element.minH}
                  onClose={() => closePanel("element")}
                >
                  <LeftPanel
                    config={element}
                    onChange={updateElement}
                    units={units}
                    ifc={ifcUi}
                    onImportIfc={handleImportIfc}
                    importedOutline={imported?.outline ?? null}
                  />
                </FloatingPanel>
              )}
              {openPanels.checks && (
                <FloatingPanel
                  title="Checks & Strip-Ready"
                  defaultGeo={PANEL_GEO.checks}
                  minWidth={PANEL_GEO.checks.minW}
                  minHeight={PANEL_GEO.checks.minH}
                  onClose={() => closePanel("checks")}
                >
                  <ChecksPanel flags={sim.flags} />
                </FloatingPanel>
              )}
              {openPanels.pour && (
                <FloatingPanel
                  title="Pour Window"
                  defaultGeo={PANEL_GEO.pour}
                  minWidth={PANEL_GEO.pour.minW}
                  minHeight={PANEL_GEO.pour.minH}
                  onClose={() => closePanel("pour")}
                >
                  <PourWindowTable candidates={candidates} />
                </FloatingPanel>
              )}
            </div>
          </div>
          <TimeScrubber
            times_h={sim.times_h}
            timeIndex={timeIndex}
            onTimeChange={handleTimeChange}
          />
        </div>
      </div>
    </div>
  );
}
