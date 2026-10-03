"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import type { NavItem } from "./nav";

export function isActive(href: string, pathname: string, search: string) {
  const [path, query] = href.split("?");
  if (query) return pathname === path && search.includes(query);
  if (path === "/") return pathname === "/";
  if (path === "/supplier") return pathname.startsWith("/supplier") && !search.includes("view=");
  return pathname.startsWith(path);
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const mobile = items.filter((i) => i.icon !== "admin").slice(0, 5);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-graphite-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Primary">
      <ul className="grid grid-cols-5">
        {mobile.map((item) => {
          const active = isActive(item.href, pathname, search);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-navy-800" : "text-graphite-500"}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={item.icon} className={`h-5 w-5 ${active ? "stroke-[2.2]" : ""}`} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function DesktopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
      {items
        .filter((i) => i.icon !== "account")
        .map((item) => {
          const active = isActive(item.href, pathname, search);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-white/10 text-white" : "text-white/70 hover:text-white"}`}
            >
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}
