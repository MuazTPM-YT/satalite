// Shared interface primitives.
//
// Every one of these existed before as a hand-typed class string repeated across
// components - the section label alone appeared seventeen times, and the toolbar
// pills had drifted into three different heights. Defining them once is what
// makes the panels look like one instrument rather than six.
//
// No directive here on purpose: nothing in this file uses a hook, so it inherits
// client-ness from whichever component imports it rather than declaring its own
// boundary (which would make Next treat these callback props as Server Actions).

import type { ComponentType, ReactNode } from "react";

export type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

/** Join class names, dropping anything falsy. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Labels ─────────────────────────────────────────────────────────────────── */

/**
 * The small uppercase label that titles a region. Optionally takes a leading
 * icon and a trailing note - the note is where a region says what its numbers
 * are measured against, which is the one thing a reader needs before the numbers.
 */
export function SectionLabel({
  icon: Icon,
  children,
  note,
  className,
}: {
  icon?: Icon;
  children: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center gap-2 min-w-0", className)}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />}
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary whitespace-nowrap">
        {children}
      </span>
      {note && (
        <span className="ml-auto truncate text-[10px] text-text-muted">{note}</span>
      )}
    </div>
  );
}

/** A horizontal rule that carries a label - the divider between panel sections. */
export function SectionRule({ icon, children }: { icon?: Icon; children: ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex items-center gap-2 border-t border-border-default pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <SectionLabel icon={icon}>{children}</SectionLabel>
    </div>
  );
}

/* ── Readouts ───────────────────────────────────────────────────────────────── */

/**
 * One measured quantity: what it is, what it reads, and optionally the field it
 * came from. Mono and tabular so a column of these lines up.
 */
export function Readout({
  label,
  value,
  unit,
  tone = "default",
  field,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  tone?: "default" | "amber" | "red" | "green" | "accent";
  /** The response field this came from, shown as provenance. */
  field?: string;
}) {
  const toneClass = {
    default: "text-text-primary",
    amber: "text-status-amber",
    red: "text-status-red",
    green: "text-status-green",
    accent: "text-accent-blue",
  }[tone];

  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="min-w-0 truncate text-[11px] text-text-muted" title={field}>
        {label}
      </span>
      <span className={cx("shrink-0 font-mono text-[12px] tabular-nums", toneClass)}>
        {value}
        {unit && <span className="ml-1 text-[10px] text-text-muted">{unit}</span>}
      </span>
    </div>
  );
}

/* ── Toolbars ───────────────────────────────────────────────────────────────── */

/**
 * The floating control pill that sits over a viewer. Translucent and blurred so
 * the drawing stays visible underneath - it is furniture on top of the model,
 * not a band cutting across it.
 */
export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "pointer-events-auto flex items-center gap-1 rounded-xl border border-hairline",
        "bg-bg-surface/85 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />;
}

/** A labelled action or view preset. */
export function ToolbarButton({
  icon: Icon,
  children,
  onClick,
  active = false,
  title,
  disabled,
}: {
  icon?: Icon;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={onClick && active !== undefined ? active : undefined}
      className={cx(
        "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium",
        active
          ? "bg-accent-blue-dim text-accent-blue"
          : "text-text-secondary hover:bg-elevate-2 hover:text-text-primary",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
      {children}
    </button>
  );
}

/**
 * An icon-only control. `label` is required and becomes both the tooltip and the
 * accessible name, so a screen reader never meets a nameless button.
 */
export function ToolbarToggle({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled,
}: {
  icon: Icon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        active
          ? "bg-accent-blue-dim text-accent-blue"
          : "text-text-muted hover:bg-elevate-2 hover:text-text-primary",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

/**
 * A segmented choice, rendered as a radiogroup so the options are announced as
 * one control with a selected member rather than as unrelated buttons.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { id: T; label: string; icon?: Icon }[];
  onChange: (next: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-lg bg-elevate-1 p-0.5 ring-1 ring-inset ring-hairline"
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cx(
              "flex items-center gap-1.5 rounded-md font-medium",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-3 text-[12px]",
              on
                ? "bg-accent-blue-dim text-accent-blue"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            {o.icon && <o.icon className="h-3.5 w-3.5" strokeWidth={2} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Status ─────────────────────────────────────────────────────────────────── */

/**
 * A pass/flag chip. Never colour alone - it always carries its word, because a
 * chip that means "over the limit" has to survive being read in greyscale.
 */
export function Flag({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "muted";
  children: ReactNode;
}) {
  const cls = {
    green: "bg-status-green-dim text-status-green",
    amber: "bg-status-amber-dim text-status-amber",
    red: "bg-status-red-dim text-status-red",
    muted: "bg-elevate-2 text-text-muted",
  }[tone];

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wider",
        cls,
      )}
    >
      {children}
    </span>
  );
}

