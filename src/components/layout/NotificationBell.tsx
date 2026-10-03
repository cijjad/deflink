"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* offline — try again on next tick */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch then poll
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function markAll() {
    await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    load();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        data-testid="notification-bell"
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent-500 px-1 text-center text-[10px] font-bold leading-4 text-white" data-testid="notification-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-graphite-200 bg-white text-graphite-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-graphite-100 px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs font-semibold text-accent-600">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-graphite-500">Nothing yet.</li>}
            {items.map((n) => (
              <li key={n.id} className={`border-b border-graphite-100 last:border-0 ${n.readAt ? "" : "bg-accent-50/60"}`}>
                <Link href={n.link ?? "#"} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-graphite-50">
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-graphite-500">{n.body}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
