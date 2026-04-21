import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import Sidebar from "./components/Sidebar";
import { SearchProvider } from "@/lib/search-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FamilyFinance AI",
  description:
    "Gestione finanziaria familiare intelligente, potenziata da Gemini.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[color:var(--color-background)] text-[color:var(--color-foreground)]">
        <SearchProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 min-w-0">{children}</main>
          </div>
          <Toaster
            position="bottom-right"
            theme="system"
            richColors
            closeButton
            toastOptions={{
              className:
                "!rounded-xl !border !border-[color:var(--color-border)] !bg-[color:var(--color-surface)] !text-[color:var(--color-foreground)] !shadow-lg",
            }}
          />
        </SearchProvider>
      </body>
    </html>
  );
}
