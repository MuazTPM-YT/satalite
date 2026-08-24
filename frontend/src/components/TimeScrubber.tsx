// Transport. Scrubs time across the run, snapping to the frames the response
// actually carries.
//
// The rail is graduated like a scale rule rather than smooth like a media player's
// progress bar: this is a drafting instrument, and the ticks say plainly that time
// here is sampled, not continuous. The frame pips underneath are the real thing —
// one per solved field frame — so it is visible that the slider cannot land
// between two of them.
"use client";

import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { SectionLabel, ToolbarToggle } from "@/components/ui";

interface TimeScrubberProps {
  times_h: number[];
  frameIndex: number;
  onTimeChange: (time_h: number) => void;
}

export default function TimeScrubber({
  times_h,
  frameIndex,
  onTimeChange,
}: TimeScrubberProps) {
  const current_h = times_h[frameIndex] ?? 0;
  const max_h = times_h[times_h.length - 1] ?? 72;
  const last = times_h.length - 1;

  // step by whole FRAMES, not by hours — the transport buttons must land on
  // something the response carries.
  const step = (delta: number) => {
    if (times_h.length === 0) return;
    const next = Math.min(last, Math.max(0, frameIndex + delta));
    onTimeChange(times_h[next]);
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border-default bg-bg-surface px-4 py-2.5">
      <SectionLabel className="shrink-0">Time</SectionLabel>

      <div className="flex shrink-0 items-center gap-0.5">
        <ToolbarToggle
          icon={ChevronFirst}
          label="First frame"
          onClick={() => step(-last)}
          disabled={frameIndex === 0}
        />
        <ToolbarToggle
          icon={ChevronLeft}
          label="Previous frame"
          onClick={() => step(-1)}
          disabled={frameIndex === 0}
        />
        <ToolbarToggle
          icon={ChevronRight}
          label="Next frame"
          onClick={() => step(1)}
          disabled={frameIndex >= last}
        />
        <ToolbarToggle
          icon={ChevronLast}
          label="Last frame"
          onClick={() => step(last)}
          disabled={frameIndex >= last}
        />
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
        0 h
      </span>

      <div className="scale-rail relative min-w-0 flex-1">
        <input
          id="time-scrubber"
          type="range"
          min={0}
          max={max_h}
          step={0.1}
          value={current_h}
          onChange={(e) => onTimeChange(Number(e.target.value))}
          aria-label="Time after placement"
          aria-valuetext={`${current_h.toFixed(1)} hours after placement`}
          className="relative z-10"
        />
        {/* one pip per solved frame — the slider snaps to these and nowhere else */}
        <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-1.5">
          {times_h.map((h, i) => (
            <span
              key={h}
              className={
                i === frameIndex
                  ? "absolute top-0 h-1.5 w-px -translate-x-1/2 bg-accent-blue"
                  : "absolute top-0 h-1 w-px -translate-x-1/2 bg-draft-line"
              }
              style={{ left: `${max_h > 0 ? (h / max_h) * 100 : 0}%` }}
            />
          ))}
        </div>
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
        {max_h.toFixed(0)} h
      </span>

      <div className="flex shrink-0 items-baseline gap-1.5 rounded-lg bg-elevate-1 px-2.5 py-1 ring-1 ring-inset ring-hairline">
        <span className="font-mono text-[13px] font-semibold tabular-nums text-text-primary">
          {current_h.toFixed(1)}
        </span>
        <span className="font-mono text-[10px] text-text-muted">h</span>
        <span className="text-[11px] text-text-muted">after placement</span>
      </div>
    </div>
  );
}
