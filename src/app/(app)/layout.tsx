import { Sidebar, MobileTopBar, MobileBottomNav } from "@/components/sidebar";
import { DownloadsProvider } from "@/components/downloads-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DownloadsProvider>
      <div className="md:flex md:min-h-screen">
        <Sidebar />
        {/* Mobile: a fixed-height app shell — top bar, scrollable content, bottom tabs.
            Desktop (md+): the column just grows and the window scrolls as before. */}
        <div className="flex h-[100dvh] min-w-0 flex-1 flex-col overflow-hidden md:h-auto md:min-h-screen md:overflow-visible">
          <MobileTopBar />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain md:overflow-visible">
            {children}
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </DownloadsProvider>
  );
}
