import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev Label Desk",
  description: "Upload a dataset, define Jev criteria, batch-label via OpenRouter Decisions, export CSV.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
