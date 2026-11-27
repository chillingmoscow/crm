"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { cn } from "@/lib/utils";
import { ScheduleDemo } from "./schedule-demo";
import { SheerlyLogo } from "./sheerly-logo";

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
 * Каркас страниц входа, регистрации и восстановления пароля: слева форма,
 * справа (с `lg`) — живое демо расписания. На телефоне демо нет: форма
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
        <main className="flex min-w-0 flex-1 flex-col px-6 py-6 sm:px-12 sm:py-8">
          <SheerlyLogo className="h-8 w-auto self-start" />
          <div className="flex flex-1 items-center justify-center py-12">
            <div className="motion-rise w-full max-w-[400px]">{children}</div>
          </div>
        </main>

        <aside className="sticky top-0 hidden h-dvh w-[52%] shrink-0 p-3 lg:flex">
          <div className="flex flex-1 flex-col items-center justify-center gap-8 rounded-xl bg-muted px-12 py-12">
            <ScheduleDemo />
            <div className="max-w-sm text-center">
              <h2 className="text-xl font-semibold">График смен за пару минут</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Соберите неделю из шаблонов, опубликуйте команде и держите под
                рукой замены, часы и выплаты.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </AuthLeaveContext.Provider>
  );
}
