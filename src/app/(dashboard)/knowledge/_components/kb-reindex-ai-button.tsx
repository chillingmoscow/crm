"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reembedAllKbPages } from "@/lib/knowledge/embeddings";

/**
 * Кнопка «Переиндексировать для ИИ» на дашборде базы знаний.
 *
 * Зачем: эмбеддинги страниц создаются только при сохранении
 * страницы. Контент, созданный до включения ИИ (или до смены
 * embedding-модели), в AI-поиске не находится — ассистент отвечает
 * «в базе знаний нет страниц для ответа». Этот разовый прогон
 * индексирует все живые страницы аккаунта.
 *
 * Идемпотентно: content-hash guard внутри пропускает уже
 * проиндексированные страницы за один SELECT — жать повторно
 * безопасно. Рендерится только при включённом ИИ + праве (решает
 * сервер на дашборде).
 */
export function KbReindexAiButton() {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const res = await reembedAllKbPages();
      if (res.error) {
        toast.error(`Не удалось переиндексировать: ${res.error}`);
        return;
      }
      if (res.total === 0) {
        toast.info("В базе знаний пока нет страниц");
        return;
      }
      const parts = [`проиндексировано ${res.embedded} из ${res.total}`];
      if (res.skipped > 0) parts.push(`без изменений ${res.skipped}`);
      if (res.failed > 0) parts.push(`ошибок ${res.failed}`);
      const msg = `База знаний переиндексирована: ${parts.join(", ")}`;
      if (res.failed > 0) toast.warning(msg);
      else toast.success(msg);
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
      title="Проиндексировать все страницы для ИИ-поиска. Можно жать повторно."
    >
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending ? "Индексируем…" : "Переиндексировать для ИИ"}
    </Button>
  );
}
