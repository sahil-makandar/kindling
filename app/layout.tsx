import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Big_Shoulders, Young_Serif } from "next/font/google";
import "./globals.css";
import { APP_NAME, TAGLINE } from "@/src/config/brand";
import { SiteFooter } from "@/src/ui/SiteFooter";
import { SiteHeader } from "@/src/ui/SiteHeader";

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const youngSerif = Young_Serif({
  variable: "--font-young-serif",
  weight: "400",
  subsets: ["latin"],
});

// Google Fonts folded "Big Shoulders Display" into "Big Shoulders" with an optical
// size axis. At large sizes the browser picks the display cut automatically.
const bigShoulders = Big_Shoulders({
  variable: "--font-big-shoulders",
  axes: ["opsz"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: TAGLINE,
  openGraph: { title: APP_NAME, description: TAGLINE, type: "website" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${atkinson.variable} ${youngSerif.variable} ${bigShoulders.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="no-print sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
