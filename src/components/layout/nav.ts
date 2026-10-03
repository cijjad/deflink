export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export function navFor(kind: "BUYER" | "SUPPLIER" | "PLATFORM" | null, isAdmin: boolean): NavItem[] {
  if (kind === "SUPPLIER") {
    return [
      { href: "/supplier", label: "Home", icon: "home" },
      { href: "/supplier?view=open", label: "Requests", icon: "requests" },
      { href: "/supplier?view=quoted", label: "Quotes", icon: "quotes" },
      { href: "/messages", label: "Messages", icon: "messages" },
      { href: "/account", label: "Account", icon: "account" },
    ];
  }
  const items: NavItem[] = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/requests", label: "Requests", icon: "requests" },
    { href: "/quotes", label: "Quotes", icon: "quotes" },
    { href: "/messages", label: "Messages", icon: "messages" },
    { href: "/account", label: "Account", icon: "account" },
  ];
  if (isAdmin) items.splice(4, 0, { href: "/admin", label: "Admin", icon: "admin" });
  return items;
}
