import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fatty", template: "%s · Fatty" },
  description: "A calm food logger for the full Australian nutrition panel.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The keypad resizes the page, so the amount sheet's Save stays above it.
  interactiveWidget: "resizes-content",
  // Android system bars match the pine band in light mode and the pine page in dark.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0D2F23" },
    { media: "(prefers-color-scheme: dark)", color: "#081E17" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
