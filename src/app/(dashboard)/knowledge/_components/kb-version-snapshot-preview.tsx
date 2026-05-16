"use client";

import dynamic from "next/dynamic";
import { FileText, Loader2 } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbPageProperties } from "@/app/(dashboard)/knowledge/_components/kb-page-properties";
import { kbPropertiesSchema } from "@/lib/knowledge/schemas";
import type { KbBlock, KbProperty } from "@/types/knowledge";

const KbBlockNoteEditor = dynamic(
  () =>
    import("@/components/knowledge/blocknote-editor").then(
      (m) => m.KbBlockNoteEditor,
    ),
  { ssr: false, loading: () => <div className="min-h-[180px]" /> },
);

interface KbVersionSnapshotPreviewProps {
  pageId: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  content: KbBlock[];
  properties: unknown;
}

export function KbVersionSnapshotPreview({
  pageId,
  title,
  icon,
  iconColor,
  content,
  properties,
}: KbVersionSnapshotPreviewProps) {
  const parsedProperties = kbPropertiesSchema.safeParse(properties ?? []);
  const snapshotProperties: KbProperty[] = parsedProperties.success
    ? parsedProperties.data
    : [];
  const hasContent = content.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-6 py-8 sm:px-8 lg:px-12 lg:py-10">
      <header className="space-y-5">
        <KbPageIcon icon={icon} color={iconColor} size={56} />
        <div className="space-y-2">
          <h2 className="text-[36px] font-extrabold leading-[1.15] tracking-tight text-foreground">
            {title || "Без названия"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Снимок страницы в режиме только для чтения. Комментарии и лента
            обновлений в версию не входят
          </p>
        </div>
      </header>

      {snapshotProperties.length > 0 && (
        <div className="rounded-xl border bg-background/80 px-4 py-4">
          <KbPageProperties
            targetId={pageId}
            mode="page"
            initialProperties={snapshotProperties}
            canEdit={false}
            showAddButton={false}
          />
        </div>
      )}

      <section className="rounded-xl border bg-background/80">
        {hasContent ? (
          <div className="px-4 py-5 sm:px-5 lg:px-6">
            <KbBlockNoteEditor
              key={`${pageId}-snapshot`}
              initialContent={content}
              editable={false}
            />
          </div>
        ) : (
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <FileText className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">В этой версии нет блоков</p>
            <p className="max-w-[420px] text-sm text-muted-foreground">
              Снимок сохранил заголовок и свойства страницы, но содержимое в тот
              момент было пустым.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export function KbVersionSnapshotLoading() {
  return (
    <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Загружаем снимок страницы…
    </div>
  );
}
