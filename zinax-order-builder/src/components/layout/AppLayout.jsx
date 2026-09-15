import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppLayout({ sidebarActive, topbarActive, onNavigate, children }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f4f6f9]">
      <Sidebar active={sidebarActive} onNavigate={onNavigate} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar active={topbarActive} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
