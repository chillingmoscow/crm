"use client";

import { useTransition } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { stopImpersonation } from "@/lib/impersonation/actions";

type Props = {
  targetName: string;
  roleName: string | null;
  venueName: string | null;
};

/**
 * Полоса «вы смотрите за другого пользователя».
 *
 * Сессия в этом режиме настоящая: `auth.uid()` — целевой пользователь,
 * поэтому любая запись уйдёт в БД от его имени, а `log_audit()` проставит
 * его в `audit_logs.user_id`. Отличить такую запись от настоящей потом
 * нельзя, так что баннер — единственная защита от «забыл, где я». Отсюда
 * fixed и полная ширина: он не должен уезжать при скролле.
 *
 * Палитра warning из docs/design-system.md §«Dark-варианты статусных
 * бейджей» (эталон — InventoryStatusBadge), rounded-none — по §«Скругления»
 * для разделителей-баннеров на всю ширину.
 */
export function ImpersonationBanner({ targetName, roleName, venueName }: Props) {
  const [pending, startTransition] = useTransition();

  const subtitle = [roleName, venueName].filter(Boolean).join(" · ");

  const handleReturn = () => {
    startTransition(async () => {
      // Успех уводит редиректом внутри самого action'а — сюда попадаем
      // только когда вернуть сессию не удалось. catch на случай сетевого
      // сбоя: без него кнопка молча не сработает, а это единственный
      // выход из режима просмотра.
      try {
        const result = await stopImpersonation();
        if (result?.error) toast.error(result.error);
      } catch {
        toast.error("Не удалось вернуться к себе — попробуйте ещё раз");
      }
    });
  };

  return (
    <div
      className={
        // fixed, а не sticky. В globals.css у html и body стоит
        // overflow-x: hidden — это делает body scroll-контейнером и ломает
        // прилипание к вьюпорту: баннер просто уезжал вверх вместе со
        // страницей. Место под него освобождает padding-top на
        // sidebar-враппере (см. dashboard/layout.tsx).
        "fixed inset-x-0 top-0 z-50 flex items-center gap-3 rounded-none border-b " +
        "border-amber-200 bg-amber-50 px-4 py-2 md:px-6 " +
        "dark:border-amber-500/30 dark:bg-amber-500/15"
      }
    >
      <Eye className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <p className="min-w-0 flex-1 truncate text-[13px] leading-snug text-amber-700 dark:text-amber-300">
        Вы смотрите Sheerly глазами{" "}
        <span className="font-medium">{targetName}</span>
        {subtitle ? <span className="opacity-80"> · {subtitle}</span> : null}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={handleReturn}
        className={
          "h-8 shrink-0 border-amber-300 bg-transparent text-amber-800 " +
          "hover:bg-amber-100 hover:text-amber-900 " +
          "dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20 " +
          "dark:hover:text-amber-100"
        }
      >
        {pending ? "…" : "Вернуться к себе"}
      </Button>
    </div>
  );
}
