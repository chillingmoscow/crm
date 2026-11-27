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
 *
 * Кнопка действия («Открыть», «Отменить») — в тон уведомления: прозрачная,
 * цвет текста тоста, тонкая рамка того же цвета. По умолчанию sonner красит её
 * в цвет текста темы — на зелёном тосте выходила чёрная плашка. Правило одно
 * на все тосты; `!` — потому что стили sonner заданы селектором атрибутов.
 */
const TOAST_ACTION_BUTTON =
  "!h-7 !rounded-md !border !border-solid !border-[color-mix(in_srgb,currentColor_30%,transparent)] !bg-transparent !px-2.5 !text-xs !font-medium !text-current transition-colors hover:!bg-[color-mix(in_srgb,currentColor_10%,transparent)] focus-visible:!shadow-[0_0_0_2px_color-mix(in_srgb,currentColor_35%,transparent)]";

function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      richColors
      position="top-center"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      expand
      visibleToasts={4}
      toastOptions={{ classNames: { actionButton: TOAST_ACTION_BUTTON } }}
    />
  );
}
