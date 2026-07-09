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
    <html lang="en">
      <body className="bg-ballot text-ink font-body antialiased">
        {children}
      </body>
    </html>
  );
}
