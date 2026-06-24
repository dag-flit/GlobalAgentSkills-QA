"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/* ---------- íconos (estilo lucide, stroke currentColor) ---------- */

type IconProps = { className?: string };
const svg = (children: React.ReactNode) => ({ className = "w-5 h-5" }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const IconPlay = svg(<path d="M7 4v16l13-8z" />);
const IconHistory = svg(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </>
);
const IconDatabase = svg(
  <>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
  </>
);
const IconSettings = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
);
const IconChevron = svg(<path d="M15 18l-6-6 6-6" />);

/* ---------- menú ---------- */

type Item = { href: string; label: string; Icon: (p: IconProps) => React.ReactElement };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Flujo",
    items: [
      { href: "/", label: "Ejecutar", Icon: IconPlay },
      { href: "/runs", label: "Historial", Icon: IconHistory },
    ],
  },
  {
    title: "Configuración",
    items: [
      { href: "/databases", label: "Bases de datos", Icon: IconDatabase },
      { href: "/settings", label: "Ajustes", Icon: IconSettings },
    ],
  },
];

function NavItem({ item, collapsed }: { item: Item; collapsed: boolean }) {
  const path = usePathname();
  const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-accent/15 text-accent" : "text-gray-300 hover:bg-panel2 hover:text-white"
      } ${collapsed ? "justify-center" : ""}`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-accent" />
      )}
      <Icon className="w-5 h-5 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // recordar preferencia de colapso entre visitas
  useEffect(() => {
    const saved = localStorage.getItem("qof-sidebar-collapsed");
    if (saved != null) setCollapsed(saved === "1");
  }, []);
  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("qof-sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen flex">
      <aside
        className={`sticky top-0 h-screen shrink-0 border-r border-border bg-panel/70 backdrop-blur flex flex-col transition-[width] duration-200 ${
          collapsed ? "w-[68px]" : "w-64"
        }`}
      >
        {/* marca + botón de colapsar (arriba, siempre visible) */}
        <div className={`h-14 flex items-center px-3 ${collapsed ? "justify-center" : "gap-2"}`}>
          {!collapsed && (
            <>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent font-bold shrink-0">
                Q
              </span>
              <span className="flex-1 min-w-0 font-bold tracking-tight text-white leading-tight">
                Quality<span className="text-accent">Ops</span>
                <span className="block text-[10px] font-normal text-muted -mt-0.5">Framework</span>
              </span>
            </>
          )}
          <button
            onClick={toggle}
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
            title={collapsed ? "Expandir menú" : "Colapsar menú"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-panel2 hover:text-white transition-colors"
          >
            <IconChevron className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* navegación */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-1">
              {!collapsed && (
                <p className="px-3 text-[10px] uppercase tracking-wider text-muted/70 font-semibold">
                  {g.title}
                </p>
              )}
              {g.items.map((it) => (
                <NavItem key={it.href} item={it} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* contenido */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 py-6">{children}</main>
        <footer className="text-center text-xs text-muted py-4 border-t border-border">
          Quality Ops Framework · interfaz del qa-kit
        </footer>
      </div>
    </div>
  );
}
