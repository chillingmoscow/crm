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
      {/* `expand` — все одновременные тосты разворачиваются в вертикальный
          стек, а не складываются в одну точку с эффектом «стопка карт»
          (default sonner). Так юзер видит каждое уведомление отдельно
          без необходимости hover'ом раскрывать стопку. */}
      <Toaster
        richColors
        position="top-center"
        theme="system"
        expand
        visibleToasts={4}
      />
    </ThemeProvider>
  );
}
