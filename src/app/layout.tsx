import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Providers } from "@/components/shared/providers";
import { GlobalTooltip } from "@/components/ui/global-tooltip";

import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CRM Platform",
  description: "Корпоративная платформа управления заведениями",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className={inter.variable}>
      <body className="antialiased font-sans">
        <Providers>{children}</Providers>
        <GlobalTooltip />
      </body>
    </html>
  );
}
