// time scrubber. horizontal slider 0–72h, wired to parent timeIndex
"use client";


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

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-border-default bg-bg-surface">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary shrink-0">
        Time
      </span>
      <span className="text-[11px] text-text-muted shrink-0">0 h</span>
      <input
        id="time-scrubber"
        type="range"
        min={0}
        max={max_h}
        step={0.1}
        value={current_h}
        onChange={(e) => onTimeChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="text-[11px] text-text-muted shrink-0 tabular-nums">{max_h.toFixed(0)} h</span>
      <span className="text-xs text-text-secondary shrink-0 ml-2">
        <span className="font-semibold text-text-primary">
          {current_h.toFixed(1)} h
        </span>
        {" "}after placement
      </span>
    </div>
  );
}
