// viewer placeholder. real 3D/2D canvas goes here in phase 3
export default function Viewer() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* toolbar row */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-0.5 bg-bg-primary rounded-md p-0.5">
          <button className="px-3 py-1 text-xs rounded text-text-secondary hover:text-text-primary transition-colors">
            ☐ Top
          </button>
          <button className="px-3 py-1 text-xs rounded bg-bg-elevated text-text-primary font-medium">
            ◧ Front
          </button>
          <button className="px-3 py-1 text-xs rounded text-text-secondary hover:text-text-primary transition-colors">
            ◇ Iso
          </button>
        </div>

        <div className="w-px h-4 bg-border-default mx-1" />

        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Grid">
          ⊞
        </button>
        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Eye">
          ◉
        </button>
        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Section">
          ◫
        </button>

        <div className="ml-2 px-3 py-1 text-xs rounded-md bg-bg-primary border border-border-default text-text-primary">
          Temperature
        </div>

        <div className="flex-1" />

        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Shrink">
          ◁ ▷
        </button>
        <button className="p-1.5 text-xs text-text-secondary hover:text-text-primary rounded transition-colors" title="Expand">
          ⤢
        </button>
      </div>

      {/* canvas placeholder */}
      <div className="flex-1 relative flex items-center justify-center bg-bg-primary">
        <div className="text-text-muted text-sm select-none">
          3D Viewer — Phase 3
        </div>

        {/* bottom-left annotation */}
        <div className="absolute bottom-12 left-4 text-[11px] text-text-muted">
          2D cross-section solution, extruded. End effects not modelled.
        </div>

        {/* bottom-right interaction hints */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 items-end">
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span className="text-text-muted">⊕</span>
            <span>Orbit</span>
            <span className="text-text-muted">Left Click + Drag</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span className="text-text-muted">+</span>
            <span>Pan</span>
            <span className="text-text-muted">Right Click + Drag</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span className="text-text-muted">⊡</span>
            <span>Probe</span>
            <span className="text-text-muted">Click Surface</span>
          </div>
        </div>

        {/* right-side color legend placeholder */}
        <div className="absolute top-4 right-4 flex flex-col items-center gap-0.5">
          <span className="text-[10px] text-text-muted mb-1">°C</span>
          <div className="w-3 h-32 rounded-sm" style={{
            background: "linear-gradient(to bottom, #ef4444, #f59e0b, #22c55e, #3b82f6, #1e40af)"
          }} />
          <div className="flex flex-col items-end text-[9px] text-text-muted mt-1">
            <span>75</span>
            <span className="mt-5">50</span>
            <span className="mt-5">25</span>
          </div>
        </div>
      </div>
    </div>
  );
}
