"use client";

import type { useRouter } from "next/navigation";
import { toast } from "sonner";

import { softDeleteKbPage, restoreKbPage } from "@/lib/knowledge/pages";
import { kbToastTitle } from "@/lib/knowledge/toast-title";
import { errorText } from "@/lib/actions/error-text";

type Router = ReturnType<typeof useRouter>;

/**
 * Soft-delete страницы БЕЗ confirm-диалога: удаление обратимо (страница
 * уходит в корзину, не стирается), поэтому подтверждение лишнее. Вместо
 * него — обычное уведомление сверху с действием «Отменить» (cascade
 * restore через kb_restore_cascade). Notion-паттерн.
 *
 * `redirectToIndex` (default true): после удаления уводим на /knowledge
 * — актуально, когда удаляемая страница открыта. Для tree-node меню
 * тоже true (паритет с прежним поведением диалога).
 */
export async function softDeletePageWithUndo({
  pageId,
  pageTitle,
  childCount,
  router,
  redirectToIndex = true,
}: {
  pageId: string;
  pageTitle: string;
  childCount: number;
  router: Router;
  redirectToIndex?: boolean;
}): Promise<void> {
  const { error } = await softDeleteKbPage(pageId);
  if (error) {
    toast.error(errorText(new Error(error), "Не удалось переместить страницу в корзину"));
    return;
  }

  const title = pageTitle?.trim() || "Без названия";
  // Обычное уведомление, не ошибка: удаление обратимо. Одна строка —
  // длинное название сокращаем, «Восстановить можно из корзины» не пишем:
  // для этого есть «Отменить» (замечание владельца 28.11.2026).
  toast(`«${kbToastTitle(title)}» в корзине`, {
    description:
      childCount > 0 ? `Вместе с вложенными страницами: ${childCount}` : undefined,
    action: {
      label: "Отменить",
      onClick: async () => {
        const { error: restoreError } = await restoreKbPage(pageId);
        if (restoreError) {
          toast.error(errorText(new Error(restoreError), "Не удалось восстановить страницу"));
          return;
        }
        toast.success(`«${kbToastTitle(title)}» восстановлена`);
        router.refresh();
      },
    },
    duration: 6000,
  });

  if (redirectToIndex) router.push("/knowledge");
  router.refresh();
}
