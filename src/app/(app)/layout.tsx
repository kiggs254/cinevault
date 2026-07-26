import { Sidebar } from "@/components/sidebar";
import { DownloadsProvider } from "@/components/downloads-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DownloadsProvider>
      <div className="md:flex md:min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </DownloadsProvider>
  );
}
