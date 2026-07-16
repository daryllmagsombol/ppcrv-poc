import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPCRV Election Results",
  description:
    "Philippine election results dashboard — verified by PPCRV volunteers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-PH">
      <body className="bg-ballot text-ink font-body antialiased">
        <header className="border-b border-gray-200 bg-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-serif text-lg font-bold text-[#1B3A5C]">
              PPCRV
            </Link>
            <Link href="/results" className="text-sm text-gray-600 hover:text-[#1B3A5C]">
              Results
            </Link>
            <Link href="/analytics" className="text-sm text-gray-600 hover:text-[#1B3A5C]">
              Analytics
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
