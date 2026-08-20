// time scrubber. horizontal slider 0–72h
"use client";

export default function TimeScrubber() {
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
        max={72}
        step={0.1}
        defaultValue={0}
        className="flex-1"
      />
      <span className="text-[11px] text-text-muted shrink-0">72 h</span>
      <span className="text-xs text-text-secondary shrink-0 ml-2">
        <span className="font-semibold text-text-primary">0.0 h</span>
        {" "}after placement · <span className="text-text-primary">04:00</span>
      </span>
    </div>
  );
}
