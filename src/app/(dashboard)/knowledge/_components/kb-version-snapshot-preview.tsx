"use client";

import dynamic from "next/dynamic";
import { FileText } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { EmptyState } from "@/components/ui/empty-state";
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

  // Снимок читается как сама страница: колонка 720, заголовок 28px, без
  // карточек вокруг (окно и так рамка).
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-8">
      <header className="space-y-4">
        <KbPageIcon icon={icon} color={iconColor} size={44} />
        <h2 className="text-[28px] font-bold leading-[1.2] tracking-[-0.25px] text-foreground">
          {title || "Без названия"}
        </h2>
      </header>

      {snapshotProperties.length > 0 && (
        <KbPageProperties
          targetId={pageId}
          mode="page"
          initialProperties={snapshotProperties}
          canEdit={false}
          showAddButton={false}
        />
      )}

      {hasContent ? (
        <KbBlockNoteEditor key={`${pageId}-snapshot`} initialContent={content} editable={false} />
      ) : (
        <EmptyState
          icon={FileText}
          title="В этой версии нет текста"
          description="Снимок сохранил заголовок и свойства, содержимое тогда было пустым"
        />
      )}
    </div>
  );
}
