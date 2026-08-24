// floating palette over viewer canvas — drag by title bar, resize edges, X close
"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Rnd } from "react-rnd";
import { X } from "lucide-react";
import { SectionLabel } from "@/components/ui";

// bump-on-focus z ordering across open palettes
let zTop = 100;

// breathing room kept between a palette and the edge of the viewer it opens over
const EDGE_MARGIN_PX = 16;

/** The overlay's measured size. `null` until the browser has measured it. */
export interface ContainerSize {
  w: number;
  h: number;
}

export interface PanelGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

// PANEL_GEO carries hand-picked spawn coordinates. On a small viewport some of them
// open past the bottom or the right edge, and `bounds="parent"` does not help: it
// constrains DRAGGING, not the initial geometry, so the palette opens overflowing and
// then jumps the moment its title bar is grabbed. Clamp before it is ever shown.
function clampGeo(
  geo: PanelGeometry,
  size: ContainerSize,
  minWidth: number,
  minHeight: number,
): PanelGeometry {
  const w = Math.max(minWidth, Math.min(geo.w, size.w - 2 * EDGE_MARGIN_PX));
  const h = Math.max(minHeight, Math.min(geo.h, size.h - 2 * EDGE_MARGIN_PX));
  return {
    w,
    h,
    x: Math.max(EDGE_MARGIN_PX, Math.min(geo.x, size.w - w - EDGE_MARGIN_PX)),
    y: Math.max(EDGE_MARGIN_PX, Math.min(geo.y, size.h - h - EDGE_MARGIN_PX)),
  };
}

interface FloatingPanelProps {
  title: string;
  // whether the palette is open. A closed palette stays MOUNTED so its exit
  // transition has something to run on; CSS takes it out of the layout.
  open: boolean;
  // The overlay's measured size, owned by the page. Passing it down rather than
  // observing it here means every palette re-clamps off the SAME measurement, at
  // the same moment - and it is a plain reactive dependency rather than an
  // observer that has to be trusted to fire.
  containerSize: ContainerSize | null;
  // where the palette opens before first drag/resize
  defaultGeo: PanelGeometry;
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  children: ReactNode;
}

export default function FloatingPanel({
  title,
  open,
  containerSize,
  defaultGeo,
  minWidth = 240,
  minHeight = 120,
  onClose,
  children,
}: FloatingPanelProps) {
  const [z, setZ] = useState(() => ++zTop);
  const [geo, setGeo] = useState<PanelGeometry | null>(null);

  // Keep the palette inside the overlay.
  //
  // This doubles as the hydration guard. react-rnd writes its inline styles slightly
  // differently on the server than in the browser ("translate(90px, 40px)" vs
  // "translate(90px,40px)", top: "0px" vs 0), which React reports as a hydration
  // mismatch and then refuses to patch up - leaving the panel positioned by the
  // SERVER's markup. The size prop is null until the browser measures, so `geo` is
  // null on the server and the palette renders nothing there.
  //
  // Clamping once at mount was not enough: the viewer shrinks when the scopes dock
  // arrives with the run, and again on every window resize. A palette measured
  // against the taller container just stayed there, hanging off the bottom. This
  // only ever pulls a palette back INSIDE - it never recentres one the user has
  // deliberately placed.
  //
  // Adjusting during render rather than in an effect is React's documented pattern
  // for reacting to a changed prop, and it avoids painting the palette once at the
  // stale geometry before correcting it.
  const [fittedTo, setFittedTo] = useState<ContainerSize | null>(null);
  if (containerSize && containerSize !== fittedTo) {
    setFittedTo(containerSize);
    setGeo((prev) => {
      const next = clampGeo(prev ?? defaultGeo, containerSize, minWidth, minHeight);
      // Keep the same object when nothing moved, so a resize does not restart the
      // enter transition or fight a drag in progress.
      return prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.w === next.w &&
        prev.h === next.h
        ? prev
        : next;
    });
  }

  // Every palette stays mounted for the whole session now, so mount order is no longer
  // the same thing as open order - opening one has to raise it explicitly. Adjusting
  // state during render (rather than in an effect) is React's documented pattern for
  // reacting to a changed prop, and avoids rendering the palette once at a stale depth.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setZ(++zTop);
  }

  // raise this palette above siblings on interaction
  const raise = () => setZ(++zTop);

  if (!geo) return null;

  return (
    <Rnd
      // Controlled, not `default`: `default` is read once at mount, so a palette
      // could never be pulled back in-bounds after the container changed size.
      size={{ width: geo.w, height: geo.h }}
      position={{ x: geo.x, y: geo.y }}
      onDragStop={(_e, d) => setGeo((g) => (g ? { ...g, x: d.x, y: d.y } : g))}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        setGeo({ x: pos.x, y: pos.y, w: ref.offsetWidth, h: ref.offsetHeight })
      }
      bounds="parent"
      dragHandleClassName="panel-drag-handle"
      minWidth={minWidth}
      minHeight={minHeight}
      enableUserSelectHack={false}
      // a closed palette is invisible but still mounted - it must not eat clicks meant
      // for the canvas underneath, or for another palette.
      className={open ? "pointer-events-auto" : "pointer-events-none"}
      style={{ zIndex: z }}
      onPointerDown={raise}
    >
      {/* display/opacity/transform are owned by .floating-panel in globals.css */}
      <div
        data-open={open}
        className="floating-panel h-full w-full flex-col overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-2xl shadow-black/50 ring-1 ring-inset ring-hairline"
      >
        {/* title bar — drag handle + close */}
        <div className="panel-drag-handle flex shrink-0 cursor-move select-none items-center gap-2 border-b border-border-default bg-elevate-1 px-3 py-2">
          <SectionLabel className="min-w-0 flex-1">{title}</SectionLabel>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-elevate-2 hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
        {/* body scrolls when content taller than palette */}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </Rnd>
  );
}
