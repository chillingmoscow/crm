"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { cn } from "@/lib/utils";
import { SheerlyLogo } from "./sheerly-logo";
import { VenueDemo } from "./venue-demo";

const LEAVE_MS = 200;

const AuthLeaveContext = createContext<(href: string) => void>((href) => {
  window.location.assign(href);
});

/**
 * Уход со страницы входа в приложение: страница мягко гаснет до цвета фона
 * темы и только потом загружается приложение — без белой вспышки и рывка.
 * Полная загрузка, а не `router.push`: смена пользователя — новая сессия,
 * и закэшированные данные прошлого входа не должны пережить её.
 */
export function useAuthLeave() {
  return useContext(AuthLeaveContext);
}

/**
 * Каркас страниц входа, регистрации и восстановления пароля: слева (с `xl`, от 1280px)
 * — живое демо заведения, справа форма. На телефоне демо нет: форма
 * во всю ширину.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback((href: string) => {
    setLeaving(true);
    window.setTimeout(() => window.location.assign(href), LEAVE_MS);
  }, []);

  return (
    <AuthLeaveContext.Provider value={leave}>
      <div
        className={cn(
          "flex min-h-dvh bg-background text-foreground transition-opacity duration-200 ease-in",
          leaving && "pointer-events-none opacity-0",
        )}
      >
        {/* Низкое окно: сначала уходит подпись, потом нижний ряд карточек
            (VenueDemo), на совсем низком — вся панель, чтобы ничего не
            обрезалось. */}
        <aside className="sticky top-0 hidden h-dvh w-[56%] shrink-0 p-3 xl:flex [@media(max-height:460px)]:!hidden">
          <div className="flex flex-1 flex-col justify-center gap-8 overflow-hidden rounded-xl bg-muted px-12 py-12 2xl:px-16">
            <div className="max-w-lg">
              <h2 className="text-[32px] font-bold leading-tight tracking-tight">
                Всё заведение — в одном окне
              </h2>
              <p className="mt-3 text-base text-muted-foreground [@media(max-height:640px)]:hidden">
                Люди, смены, продажи, деньги и склад. Без таблиц и пересылки
                скриншотов.
              </p>
            </div>
            <VenueDemo />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col px-6 py-6 sm:px-12 sm:py-8">
          <SheerlyLogo className="h-8 w-auto self-start" />
          <div className="flex flex-1 items-center justify-center py-12">
            <div className="motion-rise w-full max-w-[400px]">{children}</div>
          </div>
        </main>
      </div>
    </AuthLeaveContext.Provider>
  );
}
