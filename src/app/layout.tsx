import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BottomNav, DesktopNav } from "@/components/layout/BottomNav";
import { Logo } from "@/components/layout/Logo";
import { navFor } from "@/components/layout/nav";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { getCurrentUser } from "@/server/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DefLink — Global Procurement & Sourcing", template: "%s · DefLink" },
  description: "Tell us what you need. We help you source it — from verified suppliers worldwide.",
  applicationName: "DefLink",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0c1a30",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentUser();
  const items = navFor(session?.org.kind ?? null, Boolean(session?.user.isPlatformAdmin));
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-30 bg-navy-900 text-white">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
            <Link href={session?.org.kind === "SUPPLIER" ? "/supplier" : "/"} aria-label="DefLink home">
              <Logo />
            </Link>
            <Suspense>
              <DesktopNav items={session ? items : []} />
            </Suspense>
            <div className="flex items-center gap-1">
              {session ? (
                <>
                  <NotificationBell />
                  <Link href="/account" className="hidden h-10 items-center gap-2 rounded-lg px-2 text-sm text-white/80 hover:bg-white/10 hover:text-white md:flex">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">
                      {session.user.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="max-w-40 truncate">{session.org.name}</span>
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-white/85 hover:text-white">
                    Sign in
                  </Link>
                  <Link href="/register" className="hidden rounded-lg bg-white px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-graphite-100 sm:inline-flex">
                    Create account
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="pb-24 md:pb-10">{children}</main>
        <Suspense>
          <BottomNav items={items} />
        </Suspense>
      </body>
    </html>
  );
}
