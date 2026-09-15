import { useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppLayout({ sidebarActive, topbarActive, onNavigate, children }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleNavigate = (key) => {
    setMobileNavOpen(false);
    onNavigate(key);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f4f6f9]">
      <Sidebar
        active={sidebarActive}
        onNavigate={handleNavigate}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar active={topbarActive} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
