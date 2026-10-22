import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIAAS Personal · Local-first AI assistants",
  description: "Create specialized AI assistants with local models, isolated knowledge bases and reusable templates.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
