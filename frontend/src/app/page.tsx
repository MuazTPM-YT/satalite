// studio page. composes all panels into the main layout
import TopBar from "@/components/TopBar";
import LeftPanel from "@/components/LeftPanel";
import Viewer from "@/components/Viewer";
import ChecksPanel from "@/components/ChecksPanel";
import TimeScrubber from "@/components/TimeScrubber";
import PourWindowTable from "@/components/PourWindowTable";

export default function StudioPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <LeftPanel />
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <Viewer />
          <TimeScrubber />
          <PourWindowTable />
        </div>
        <ChecksPanel />
      </div>
    </div>
  );
}
