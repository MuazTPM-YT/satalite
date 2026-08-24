// The input primitives. Everything the studio types a number or picks a name into.
//
// These live apart from ui.tsx because they hold state: ui.tsx is deliberately
// hook-free so it can be imported from either side of the client boundary, and this
// file is deliberately "use client" so a number field can capture a pointer.
//
// The model is a colour grader's, not a web form's. A quantity is one row: its name,
// a track you can throw, and a box you can scrub OR type into. The box is the same
// control in all three modes, so there is never a moment where the slider and the
// number disagree about what the value is.
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
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { cx } from "@/components/ui";

/* ── helpers ────────────────────────────────────────────────────────────────── */

// snap to the step and kill the float dust a division leaves behind.
function quantize(v: number, step: number): number {
  const snapped = Math.round(v / step) * step;
  const dp = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number(snapped.toFixed(dp));
}

// how many decimals to SHOW for a given step.
function stepDecimals(step: number): number {
  return Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/* ── label column ───────────────────────────────────────────────────────────── */

/**
 * The label column every input row shares. Fixed width rather than auto: a stack
 * whose controls each start at a different x reads as a form, and this is meant to
 * read as an instrument.
 */
export function FieldLabel({
  htmlFor,
  children,
  hint,
  muted,
  width = "w-[74px]",
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  muted?: boolean;
  /** the column width. Panels share one; a toolbar row sizes to its own word. */
  width?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      title={hint}
      className={cx(
        width,
        "shrink-0 truncate text-[11px] leading-tight",
        muted ? "text-text-muted" : "text-text-secondary",
      )}
    >
      {children}
    </label>
  );
}

/* ── scrub number box ───────────────────────────────────────────────────────── */

interface ScrubBoxProps {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  onChange: (next: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
  width?: string;
  ariaLabel?: string;
}

/**
 * A number box you can drag sideways to change, or click to type into.
 *
 * The two modes are separated by distance, not by a modifier: a press that never
 * travels 3px is a click and focuses the field for typing; a press that does travel
 * captures the pointer and scrubs. That is the one interaction detail that makes a
 * scrubbable field feel like a control rather than a trap — without the threshold,
 * every attempt to click into the box nudges the value first.
 *
 * Shift is fine (0.2x), Alt is coarse (5x), matching the modifier convention every
 * editor uses for the same gesture.
 */
function ScrubBox({
  id,
  value,
  min,
  max,
  step,
  decimals,
  onChange,
  onCommit,
  disabled,
  // six characters of mono at 12px plus padding. "19.685" ft is a real value and
  // a box that clips its own last digit is worse than one that is a little wide.
  width = "w-[66px]",
  ariaLabel,
}: ScrubBoxProps) {
  // While typing, the box shows exactly what was typed - not a reformatted version of
  // it. Reformatting mid-keystroke is what makes a field eat the "." out of "0.45".
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const dragRef = useRef<{ x: number; from: number; moved: boolean } | null>(null);

  const shown = draft ?? value.toFixed(decimals);

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    // an unparseable draft snaps back to the live value rather than writing NaN.
    if (Number.isFinite(parsed)) onChange(clamp(quantize(parsed, step), min, max));
    setDraft(null);
    onCommit?.();
  };

  const nudge = (steps: number) => {
    onChange(clamp(quantize(value + steps * step, step), min, max));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (disabled || e.button !== 0) return;
    dragRef.current = { x: e.clientX, from: value, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 3) return;
      drag.moved = true;
      setScrubbing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.blur();
    }
    // one step per 3 px is close to a 1:1 feel for the ranges here, and the span
    // fallback keeps a 0-1 field from needing a 300px drag to cross itself.
    const perPx = Math.max(step, (max - min) / 400);
    const gain = e.shiftKey ? 0.2 : e.altKey ? 5 : 1;
    onChange(clamp(quantize(drag.from + (dx / 3) * perPx * gain, step), min, max));
  };

  const endDrag = (e: React.PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setScrubbing(false);
    onCommit?.();
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      disabled={disabled}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitDraft}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commitDraft();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          setDraft(null);
          nudge((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => e.currentTarget.select()}
      className={cx(
        width,
        "shrink-0 select-none text-right font-mono tabular-nums",
        scrubbing ? "cursor-ew-resize !border-accent-blue" : "cursor-ew-resize",
      )}
    />
  );
}

/* ── the row ────────────────────────────────────────────────────────────────── */

export interface ScrubFieldProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  /** fired when a drag or an edit finishes — the moment a solve is worth kicking off */
  onCommit?: () => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** shown on the label's tooltip; say what the number means, not what it is called */
  hint?: string;
  /** when given, a reset control appears as soon as the value differs from it */
  resetTo?: number;
  disabled?: boolean;
  decimals?: number;
  /** the label column width. Defaults to the panel column; a toolbar row sizes to its word. */
  labelWidth?: string;
}

/**
 * One quantity: name, scrubbable box, unit.
 *
 * There is no separate track. The box IS the slider - drag it sideways and it scrubs,
 * click it and it types - so a second control for the same number would only be a
 * second thing to disagree with it, and it was what pushed these rows wider than the
 * toolbars they sit in.
 */
export function ScrubField({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  unit,
  hint,
  resetTo,
  disabled,
  decimals,
  labelWidth,
}: ScrubFieldProps) {
  const id = useId();
  const dp = decimals ?? stepDecimals(step);
  const dirty = resetTo !== undefined && Math.abs(value - resetTo) > step / 2;

  return (
    <div className="group flex items-center gap-1.5 py-[3px]">
      <FieldLabel htmlFor={id} hint={hint} muted={disabled} width={labelWidth}>
        {label}
      </FieldLabel>

      {/* the box is pushed to the right edge so a column of these lines its digits up
          with the dropdown rows above and below it, not with its own label. */}
      <div className="ml-auto" />

      <ScrubBox
        id={id}
        ariaLabel={label}
        value={value}
        min={min}
        max={max}
        step={step}
        decimals={dp}
        onChange={onChange}
        onCommit={onCommit}
        disabled={disabled}
      />

      {/* min-width, not width: "kg/m³" is a real unit and truncating it to "kg…" is
          the one thing on this row that must never be ambiguous. */}
      <span className="min-w-[22px] shrink-0 whitespace-nowrap font-mono text-[10px] leading-none text-text-muted">
        {unit ?? ""}
      </span>

      {/* Reset stays in the layout at zero opacity rather than mounting on hover —
          a control that appears under the cursor shifts the row it belongs to. */}
      <button
        type="button"
        aria-label={`Reset ${label}`}
        title={dirty ? `Reset to ${resetTo?.toFixed(dp)}` : undefined}
        disabled={!dirty}
        onClick={() => {
          if (resetTo === undefined) return;
          onChange(resetTo);
          onCommit?.();
        }}
        className={cx(
          "-ml-0.5 flex h-5 w-4 shrink-0 items-center justify-center rounded-md",
          // `invisible`, not `opacity-0`: globals.css styles `button:disabled` with an
          // opacity of its own, and that selector out-specifies a utility class.
          dirty
            ? "text-text-muted opacity-0 hover:bg-elevate-2 hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
            : "invisible",
        )}
      >
        <RotateCcw className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
}

/* ── select ─────────────────────────────────────────────────────────────────── */

export interface SelectOption<T extends string> {
  id: T;
  label: string;
  /** the right-hand detail: what this option means in the solver's terms */
  note?: string;
  disabled?: boolean;
}

/**
 * A dropdown that is actually part of this interface.
 *
 * A native `<select>` renders its list with the operating system, which means the
 * list cannot carry the second line each of these options needs (what R value, what
 * cement heat, what the trade-off is) and cannot be styled to match anything around
 * it. This one is a listbox in a portal.
 *
 * The portal matters for a reason beyond styling: every one of these lives inside a
 * floating palette with `overflow-y: auto`, which would clip an in-flow popover to
 * the panel. Positioned fixed against the trigger's measured rect, it cannot be.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
  className,
  align = "right",
  disabled,
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (next: T) => void;
  /** accessible name. Rendered by whatever row wraps this, not by the control. */
  label: string;
  id?: string;
  className?: string;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const generated = useId();
  const listId = `${id ?? generated}-listbox`;

  const selected = options.find((o) => o.id === value);
  const enabledIndex = (from: number, dir: 1 | -1): number => {
    for (let n = 0; n < options.length; n++) {
      const i = (from + dir * n + options.length * options.length) % options.length;
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (el) setRect(el.getBoundingClientRect());
  }, []);

  const openList = () => {
    if (disabled) return;
    measure();
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };

  // Measured, not computed from layout: the trigger sits inside a palette the user
  // can drag anywhere, so the only reliable position is the one read at open time.
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // Scroll and resize move the trigger out from under an already-open list. Closing
    // is the honest response — repositioning mid-scroll reads as the list chasing you.
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (i: number) => {
    const opt = options[i];
    if (!opt || opt.disabled) return;
    onChange(opt.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => enabledIndex(i + 1, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => enabledIndex(i - 1, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(enabledIndex(0, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(enabledIndex(options.length - 1, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  // Flip above the trigger when the list would run off the bottom. 264px is the
  // list's own max height, so this asks the real question rather than a guess at one.
  const LIST_MAX_H = 264;
  const below = rect ? window.innerHeight - rect.bottom : 0;
  const flip = rect !== null && below < Math.min(LIST_MAX_H, options.length * 34 + 12) && rect.top > below;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cx(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2",
          "bg-bg-primary text-[12px] text-text-secondary",
          open ? "border-accent-blue text-text-primary" : "border-border-default hover:border-border-strong hover:text-text-primary",
          className ?? "w-[124px]",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? value}</span>
        <ChevronDown
          className={cx("h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-150", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            style={{
              position: "fixed",
              left: align === "right" ? undefined : rect.left,
              right: align === "right" ? window.innerWidth - rect.right : undefined,
              top: flip ? undefined : rect.bottom + 4,
              bottom: flip ? window.innerHeight - rect.top + 4 : undefined,
              minWidth: Math.max(rect.width, 168),
              maxHeight: LIST_MAX_H,
            }}
            className={cx(
              "z-[1000] overflow-y-auto overscroll-contain rounded-lg border border-border-default",
              "bg-bg-elevated p-1 shadow-2xl shadow-black/60 ring-1 ring-inset ring-hairline",
              "animate-[select-in_120ms_var(--ease-out-strong)]",
            )}
          >
            {options.map((o, i) => {
              const on = o.id === value;
              return (
                <div
                  key={o.id}
                  role="option"
                  aria-selected={on}
                  aria-disabled={o.disabled}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => choose(i)}
                  className={cx(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                    o.disabled && "pointer-events-none opacity-40",
                    i === active ? "bg-elevate-2" : "",
                  )}
                >
                  <Check
                    className={cx("h-3.5 w-3.5 shrink-0", on ? "text-accent-blue" : "opacity-0")}
                    strokeWidth={2.5}
                  />
                  <span
                    className={cx(
                      "min-w-0 flex-1 truncate text-[12px]",
                      on ? "text-text-primary" : "text-text-secondary",
                    )}
                  >
                    {o.label}
                  </span>
                  {o.note && (
                    <span className="shrink-0 font-mono text-[10px] text-text-muted">{o.note}</span>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/** A labelled select row, matching ScrubField's label column. */
export function SelectField<T extends string>({
  label,
  hint,
  ...rest
}: {
  label: string;
  hint?: string;
} & Omit<Parameters<typeof Select<T>>[0], "label">) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5 py-[3px]">
      <FieldLabel htmlFor={id} hint={hint}>
        {label}
      </FieldLabel>
      <div className="ml-auto flex min-w-0 items-center pr-[18px]">
        <Select<T> {...rest} id={id} label={label} className={rest.className ?? "w-[144px]"} />
      </div>
    </div>
  );
}
