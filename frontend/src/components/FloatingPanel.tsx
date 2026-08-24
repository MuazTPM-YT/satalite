// floating palette over viewer canvas — drag by title bar, resize edges, X close
"use client";

import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";
import { Rnd } from "react-rnd";

// bump-on-focus z ordering across open palettes
let zTop = 100;

// nothing to subscribe to: useSyncExternalStore is here only for its server snapshot,
// which is how a component asks "am I hydrated yet" without a setState in an effect.
const subscribeNever = () => () => {};

export interface PanelGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FloatingPanelProps {
  title: string;
  // where the palette opens before first drag/resize
  defaultGeo: PanelGeometry;
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  children: ReactNode;
}

export default function FloatingPanel({
  title,
  defaultGeo,
  minWidth = 240,
  minHeight = 120,
  onClose,
  children,
}: FloatingPanelProps) {
  const [z, setZ] = useState(() => ++zTop);
  // react-rnd writes its inline styles slightly differently on the server than in the
  // browser ("translate(90px, 40px)" vs "translate(90px,40px)", top: "0px" vs 0), which
  // React reports as a hydration mismatch and then refuses to patch up - leaving the
  // panel positioned by the SERVER's markup. A palette is client-side furniture with
  // nothing worth server-rendering, so it simply does not render until mounted.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  // raise this palette above siblings on interaction
  const raise = () => setZ(++zTop);

  if (!mounted) return null;

  return (
    <Rnd
      default={{
        x: defaultGeo.x,
        y: defaultGeo.y,
        width: defaultGeo.w,
        height: defaultGeo.h,
      }}
      bounds="parent"
      dragHandleClassName="panel-drag-handle"
      minWidth={minWidth}
      minHeight={minHeight}
      enableUserSelectHack={false}
      className="pointer-events-auto"
      style={{ zIndex: z }}
      onPointerDown={raise}
    >
      <div className="w-full h-full flex flex-col bg-bg-surface border border-border-default rounded-sm shadow-xl overflow-hidden">
        {/* title bar — drag handle + close */}
        <div className="panel-drag-handle flex items-center justify-between px-3 py-1.5 border-b border-border-default shrink-0 cursor-move select-none">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="text-text-muted hover:text-text-primary text-xs px-1.5 rounded-sm hover:bg-bg-primary transition-colors"
          >
            ✕
          </button>
        </div>
        {/* body scrolls when content taller than palette */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </Rnd>
  );
}
