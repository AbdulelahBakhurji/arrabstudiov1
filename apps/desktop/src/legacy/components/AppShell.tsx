import { useState } from "react";
import {
  Activity,
  FolderKanban,
  House,
  MessageSquare,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import logoTall from "@/assets/logotall.png";
import { TitleBar } from "@/components/TitleBar";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false },
  { to: "/employees", label: "AI Employees", icon: Users, end: false },
  { to: "/teams", label: "AI Teams", icon: UsersRound, end: false },
  { to: "/conversations", label: "Conversations", icon: MessageSquare, end: false },
  { to: "/activity", label: "Activity", icon: Activity, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

const titles: Record<string, string> = {
  "/": "Studio",
  "/projects": "Projects",
  "/employees": "AI Employees",
  "/teams": "AI Teams",
  "/conversations": "Conversations",
  "/activity": "Activity",
  "/settings": "Settings",
};

function titleForPath(pathname: string): string {
  if (pathname.startsWith("/conversations")) {
    return "Conversations";
  }
  return titles[pathname] ?? "Arrab Studio";
}

export function AppShell() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const edgeToEdge =
    location.pathname === "/" || location.pathname.startsWith("/conversations");

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <TitleBar
        currentTitle={titleForPath(location.pathname)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/8 bg-[#050505]">
            <div className="flex h-14 items-center px-4">
              <img
                src={logoTall}
                alt="Arrab Studio"
                className="brand-mark h-[22px] w-auto max-w-[140px] object-contain object-left"
              />
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 px-2.5 pt-1">
              {nav.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => {
                      const active =
                        isActive ||
                        (item.to === "/conversations" &&
                          location.pathname.startsWith("/conversations"));
                      return cn(
                        "flex items-center gap-3 rounded-md px-2.5 py-[9px] text-[13px] tracking-wide transition-colors",
                        active
                          ? "bg-white text-black"
                          : "text-neutral-400 hover:bg-white/[0.04] hover:text-white",
                      );
                    }}
                  >
                    <Icon className="size-4" strokeWidth={1.6} />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
            <div className="border-t border-white/8 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-600">Workspace</p>
              <p className="mt-1 text-xs text-neutral-400">Local studio</p>
            </div>
          </aside>
        ) : null}
        <main
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto",
            edgeToEdge ? "p-0" : "px-8 py-8",
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
