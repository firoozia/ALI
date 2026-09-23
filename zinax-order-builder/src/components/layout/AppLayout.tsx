import { useState, type ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import type { ScreenKey } from "../../types";

interface AppLayoutProps {
  sidebarActive: ScreenKey;
  topbarActive: ScreenKey;
  onNavigate: (key: ScreenKey) => void;
  children: ReactNode;
  tenantName?: string;
  onSignOut?: () => void;
}

export default function AppLayout({
  sidebarActive,
  topbarActive,
  onNavigate,
  children,
  tenantName,
  onSignOut,
}: AppLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleNavigate = (key: ScreenKey) => {
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
        <Topbar
          active={topbarActive}
          onMenuClick={() => setMobileNavOpen(true)}
          tenantName={tenantName}
          onSignOut={onSignOut}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
