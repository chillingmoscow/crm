"use client";

import { Toaster } from "sonner";
import { useTheme } from "next-themes";

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
      <AppToaster />
    </ThemeProvider>
  );
}

/**
 * Тема уведомлений — тема, выбранная в приложении, а не
 * системы: с `theme="system"` при тёмной ОС и светлом приложении тосты
 * приходили тёмными.
 *
 * `expand` — одновременные тосты разворачиваются в вертикальный стек, а не
 * складываются «стопкой карт»: каждое уведомление видно без наведения.
 */
function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      richColors
      position="top-center"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      expand
      visibleToasts={4}
    />
  );
}
