"use client";

import { Toaster } from "sonner";

import { ThemeProvider } from "@/components/shared/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <Toaster richColors position="top-right" theme="system" />
    </ThemeProvider>
  );
}
