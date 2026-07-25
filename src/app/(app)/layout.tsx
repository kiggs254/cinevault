import { Sidebar } from "@/components/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="md:flex md:min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
