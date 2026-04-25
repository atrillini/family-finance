"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import QuickCashExpense from "./QuickCashExpense";

function isAuthPage(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/register" ||
    pathname.startsWith("/register/")
  );
}

export default function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const hideSidebar = isAuthPage(pathname);

  if (hideSidebar) {
    return (
      <div className="flex min-h-screen">
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <MobileNav />
      <main className="flex-1 min-w-0 pt-[4.25rem] md:pt-0">{children}</main>
      <QuickCashExpense />
    </div>
  );
}
