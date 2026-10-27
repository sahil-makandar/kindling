import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { APP_NAME, TAGLINE } from "@/src/config/brand";
import { SiteFooter } from "@/src/ui/SiteFooter";
import { SiteHeader } from "@/src/ui/SiteHeader";

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const viewport: Viewport = { themeColor: "#FF6B35" };

export const metadata: Metadata = {
  title: { default: `${APP_NAME} - Your hidden clubs`, template: `%s | ${APP_NAME}` },
  description: TAGLINE,
  openGraph: { title: `${APP_NAME} - Your hidden clubs`, description: TAGLINE, type: "website" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${atkinson.variable} ${bricolage.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="no-print sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
