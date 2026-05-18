"use client";

import type { useRouter } from "next/navigation";
import { toast } from "sonner";

import { softDeleteKbPage, restoreKbPage } from "@/lib/knowledge/pages";

type Router = ReturnType<typeof useRouter>;

/**
 * Soft-delete страницы БЕЗ confirm-диалога: удаление обратимо (страница
 * уходит в корзину, не стирается), поэтому подтверждение лишнее. Вместо
 * него — destructive-toast сверху с действием «Отменить» (cascade
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
    toast.error(`Не удалось удалить: ${error}`);
    return;
  }

  const title = pageTitle?.trim() || "Без названия";
  toast.error(`«${title}» перемещена в корзину`, {
    description:
      childCount > 0
        ? `Вместе с вложенными страницами (${childCount}).`
        : "Восстановить можно из корзины.",
    action: {
      label: "Отменить",
      onClick: async () => {
        const { error: restoreError } = await restoreKbPage(pageId);
        if (restoreError) {
          toast.error(`Не удалось восстановить: ${restoreError}`);
          return;
        }
        toast.success(`«${title}» восстановлена`);
        router.refresh();
      },
    },
    duration: 6000,
  });

  if (redirectToIndex) router.push("/knowledge");
  router.refresh();
}
