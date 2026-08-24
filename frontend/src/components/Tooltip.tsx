// The one tooltip in the studio.
//
// Native `title` was doing this job everywhere and doing it badly: the browser's
// bubble arrives after an unconfigurable ~1 s delay, renders in the operating
// system's font at the operating system's size, cannot carry a second line of
// provenance, and never appears at all for a keyboard user. Every one of those is
// a problem for an instrument whose tooltips are mostly saying which RESPONSE FIELD
// a number came from.
//
// This is a hook rather than a wrapper component on purpose. A wrapper would have to
// put a real element around the trigger, and every trigger here lives in a flex
// toolbar where an extra box changes the layout. The hook hands back props to spread
// on the trigger and a node to render beside it - and the node is a portal, so it
// occupies no layout at all.
"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// Long enough that sweeping the pointer across a toolbar does not strobe, short
// enough that a deliberate hover is answered. The browser's own is roughly 1 s.
const OPEN_DELAY_MS = 320;
// once one tooltip is up, the next opens immediately - the reader is already reading
const CHAIN_MS = 400;
const GAP_PX = 8;
const EDGE_PX = 8;

export type TooltipPlacement = "top" | "bottom";

// Shared across every instance, so moving along a row of buttons reads as one
// tooltip following the pointer rather than six independent delays.
let lastClosedAt = 0;

interface Anchor {
  x: number;
  y: number;
  place: TooltipPlacement;
}

/** The bubble. Clamps itself into the viewport once it knows how wide it is. */
function Bubble({
  anchor,
  id,
  children,
}: {
  anchor: Anchor;
  id: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(anchor.x);

  // Measured after paint rather than guessed: the content decides the width, and a
  // tooltip that hangs off the right edge of the screen is worse than no tooltip.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const half = el.offsetWidth / 2;
    const lo = EDGE_PX + half;
    const hi = window.innerWidth - EDGE_PX - half;
    setLeft(hi < lo ? window.innerWidth / 2 : Math.max(lo, Math.min(anchor.x, hi)));
  }, [anchor.x, children]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{
        position: "fixed",
        left,
        top: anchor.y,
        transform: `translate(-50%, ${anchor.place === "top" ? "-100%" : "0"})`,
      }}
      className={[
        "pointer-events-none z-[2000] max-w-[264px] rounded-lg border border-border-default",
        "bg-bg-elevated px-2.5 py-1.5 text-[11px] leading-snug text-text-primary",
        "shadow-2xl shadow-black/60 ring-1 ring-inset ring-hairline",
        "animate-[tooltip-in_120ms_var(--ease-out-strong)]",
      ].join(" ")}
    >
      {/* the pointer. Same fill and hairline as the bubble, rotated 45°, with the two
          edges that overlap the bubble hidden behind it. */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-border-default bg-bg-elevated"
        style={
          anchor.place === "top"
            ? { bottom: -5, borderRightWidth: 1, borderBottomWidth: 1 }
            : { top: -5, borderLeftWidth: 1, borderTopWidth: 1 }
        }
      />
      <span className="relative block">{children}</span>
    </div>
  );
}

export interface TooltipHandle {
  /** spread onto the trigger element */
  trigger: {
    ref: (el: HTMLElement | null) => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    "aria-describedby": string | undefined;
  };
  /** render as a sibling of the trigger. A portal, so it costs no layout. */
  node: ReactNode;
  /** hide immediately — for a trigger whose click changes what the tooltip says */
  hide: () => void;
}

/**
 * A tooltip attached to one trigger.
 *
 * `content` may be any node, which is the point: most of these carry a sentence and
 * a monospaced field name, and `title` could only ever carry a string.
 *
 * Passing null or an empty string returns an inert handle, so a caller with an
 * optional hint does not need a branch.
 */
export function useTooltip(
  content: ReactNode,
  placement: TooltipPlacement = "bottom",
): TooltipHandle {
  const id = useId();
  const elRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const has = content !== null && content !== undefined && content !== "" && content !== false;

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setAnchor((prev) => {
      if (prev) lastClosedAt = Date.now();
      return null;
    });
  }, []);

  // Placement is decided at OPEN time from the trigger's real rect: these live in
  // palettes the user can drag anywhere, so there is no static answer.
  const place = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // flip when the preferred side has no room and the other side has more
    const wantTop = placement === "top" ? r.top > 56 : below < 56 && r.top > below;
    setAnchor({
      x: r.left + r.width / 2,
      y: wantTop ? r.top - GAP_PX : r.bottom + GAP_PX,
      place: wantTop ? "top" : "bottom",
    });
  }, [placement]);

  const open = useCallback(
    (immediate: boolean) => {
      if (!has) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      const delay = immediate || Date.now() - lastClosedAt < CHAIN_MS ? 0 : OPEN_DELAY_MS;
      if (delay === 0) {
        place();
        return;
      }
      timerRef.current = setTimeout(place, delay);
    },
    [has, place],
  );

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Anything that moves the trigger out from under an open bubble closes it, and a
  // press does too: the tooltip explained the control, the control is now doing it.
  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", hide, true);
    };
  }, [anchor, hide]);

  const setRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  return {
    trigger: {
      ref: setRef,
      onPointerEnter: () => open(false),
      onPointerLeave: hide,
      // keyboard focus shows it at once. The browser's own tooltip never did, which
      // meant every icon-only control was unlabelled for anyone not using a mouse.
      onFocus: () => open(true),
      onBlur: hide,
      "aria-describedby": anchor && has ? id : undefined,
    },
    node:
      anchor && has && typeof document !== "undefined"
        ? createPortal(
            <Bubble anchor={anchor} id={id}>
              {content}
            </Bubble>,
            document.body,
          )
        : null,
    hide,
  };
}

/**
 * The wrapper form, for a trigger that is not one of the shared primitives.
 *
 * It renders a `display: contents` span, so it adds a node to the tree but no box to
 * the layout — a flex row keeps treating the child as its own item.
 */
export default function Tooltip({
  content,
  placement,
  children,
  className,
}: {
  content: ReactNode;
  placement?: TooltipPlacement;
  children: ReactNode;
  /** set when the wrapper must be a real box (a `contents` span cannot be measured) */
  className?: string;
}) {
  const tip = useTooltip(content, placement);
  const contents = className === undefined;
  return (
    <>
      <span
        {...tip.trigger}
        // A `display: contents` span has no box of its own, so measuring it would
        // place the bubble at the top-left of the screen. Anchor on the child.
        ref={(el) =>
          tip.trigger.ref(
            contents ? ((el?.firstElementChild as HTMLElement | null) ?? el) : el,
          )
        }
        className={className ?? "contents"}
        // `display: contents` generates no box, so pointerenter/leave never fire on
        // the span itself — the bubbling pair is what makes the wrapper work.
        onPointerOver={tip.trigger.onPointerEnter}
        onPointerOut={tip.trigger.onPointerLeave}
        onFocusCapture={tip.trigger.onFocus}
        onBlurCapture={tip.trigger.onBlur}
      >
        {children}
      </span>
      {tip.node}
    </>
  );
}
