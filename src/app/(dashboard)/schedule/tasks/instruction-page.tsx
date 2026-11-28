"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/finance/combobox";
import type { TaskData, TaskInstruction } from "@/lib/schedule/tasks";
import { createKbPage } from "@/lib/knowledge/pages";
import {
  getKbAttachmentSignedUrl,
  uploadKbAttachment,
} from "@/lib/knowledge/attachments";
import { flushAllPendingSaves } from "@/lib/knowledge/pending-saves";
import { useKbAutosave } from "@/app/(dashboard)/knowledge/_components/use-kb-autosave";
import { useKbSaveState } from "@/app/(dashboard)/knowledge/_components/kb-save-status";
import { loadTaskInstructionPage, loadTaskInstructionPages, taskInstructionFileUrl } from "./actions";
import { unwrapAction } from "@/lib/actions/result";
import { toast } from "sonner";

const Reader = dynamic(
  () =>
    import("@/components/knowledge/blocknote-editor").then(
      (m) => m.KbBlockNoteEditor,
    ),
  {
    ssr: false,
    // Скелетон текста инструкции, пока грузится редактор.
    loading: () => (
      <div role="status" aria-label="Загружаем инструкцию" className="space-y-2.5 py-4">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    ),
  },
);
export function InstructionBody({
  instruction,
  kbAccess = false,
}: {
  instruction: TaskInstruction;
  kbAccess?: boolean;
}) {
  const resolve = useCallback(
    async (url: string) => {
      const signed = unwrapAction(await taskInstructionFileUrl(url));
      if (signed || !kbAccess || !url.startsWith("kbfile://")) return signed;
      return (await getKbAttachmentSignedUrl(url.slice(9))).url ?? "";
    },
    [kbAccess],
  );
  return (
    <Reader
      key={`${instruction.page_id}:${instruction.updated_at ?? ""}`}
      initialContent={instruction.content}
      editable={false}
      resolveFileUrl={resolve}
    />
  );
}
/**
 * Папка, где лежат инструкции задач: родитель, под которым больше всего
 * уже выбранных инструкций. Новая инструкция создаётся рядом с ними.
 */
function instructionFolder(
  data: TaskData,
  pages: { id: string; parent_id: string | null }[],
): string | null {
  const parentOf = new Map(pages.map((page) => [page.id, page.parent_id]));
  const counts = new Map<string, number>();
  for (const task of data.definitions) {
    const parent = task.instruction_page_id
      ? parentOf.get(task.instruction_page_id)
      : null;
    if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [parent, count] of counts)
    if (best === null || count > (counts.get(best) ?? 0)) best = parent;
  return best;
}

export function InstructionPagePicker({
  data,
  value,
  onChange,
  name,
  disabled,
}: {
  data: TaskData;
  value: string | null;
  onChange: (id: string | null) => void;
  name: string;
  disabled: boolean;
}) {
  const [pages, setPages] = useState<Extract<Awaited<ReturnType<typeof loadTaskInstructionPages>>, { ok: true }>["data"]>([]),
    [instruction, setInstruction] = useState<TaskInstruction | null>(null),
    [pageMeta, setPageMeta] = useState<{
      icon: string | null;
      icon_color: string | null;
      created_by: string | null;
    } | null>(null),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState(false);
  const canView = data.permissions.includes("kb.view_pages");
  const canCreate = data.permissions.includes("kb.create_pages");
  const [loadingPages, setLoadingPages] = useState(canView);
  const [pagesError, setPagesError] = useState(false);
  useEffect(() => {
    if (!canView) return;
    let alive = true;
    void loadTaskInstructionPages()
      .then(unwrapAction)
      .then((rows) => {
        if (!alive) return;
        setPages((current) => {
          const byId = new Map(rows.map((page) => [page.id, page]));
          for (const page of current) {
            if (!byId.has(page.id)) byId.set(page.id, page);
          }
          return [...byId.values()];
        });
      })
      .catch(() => {
        if (alive) setPagesError(true);
      })
      .finally(() => {
        if (alive) setLoadingPages(false);
      });
    return () => {
      alive = false;
    };
  }, [canView]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (!value) {
        setInstruction(null);
        setPageMeta(null);
        setError("");
        return;
      }
      void loadTaskInstructionPage(value)
        .then((r) => {
          if (alive) {
            setInstruction(r.instruction ?? null);
            setPageMeta(r.page ?? null);
            if (r.instruction) {
              const page = r.instruction;
              setPages((current) =>
                current.some((p) => p.id === page.id)
                  ? current
                  : [
                      ...current,
                      {
                        id: page.id,
                        title: page.title,
                        slug: page.slug,
                        parent_id: page.parent_id,
                      },
                    ],
              );
            }
            setError(r.error ?? "");
          }
        })
        .catch(() => {
          if (alive) setError("Не удалось загрузить инструкцию");
        });
    };
    refresh();
    // Пока инструкцию правят здесь, не перечитываем её при возврате во
    // вкладку: редактор уже держит свежий текст.
    if (editing) return () => {
      alive = false;
    };
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, [value, editing]);
  const selected = pages.find((p) => p.id === value);
  const folder = useMemo(() => instructionFolder(data, pages), [data, pages]);
  const options = useMemo(() => {
    const titles = new Map(pages.map((page) => [page.id, page.title]));
    // Сначала страницы из папки инструкций, дальше остальные по алфавиту.
    return [...pages]
      .sort(
        (a, b) =>
          Number(b.parent_id === folder) - Number(a.parent_id === folder) ||
          a.title.localeCompare(b.title, "ru"),
      )
      .map((page) => ({
        value: page.id,
        label: page.title,
        hint: titles.get(page.parent_id ?? "") ?? undefined,
      }));
  }, [pages, folder]);
  const canEditPage =
    data.permissions.includes("kb.edit_any_page") ||
    (data.permissions.includes("kb.edit_own_pages") &&
      pageMeta?.created_by === data.userId);
  async function create() {
    setCreating(true);
    try {
      const title = name.trim() || "Инструкция задачи";
      const r = await createKbPage({ title, parent_id: folder });
      if (r.error || !r.id || !r.slug) {
        toast.error(r.error ?? "Не удалось создать инструкцию");
        return;
      }
      setPages((p) => [
        ...p,
        { id: r.id!, slug: r.slug!, title, parent_id: folder },
      ]);
      setEditing(true);
      onChange(r.id);
    } catch {
      toast.error("Не удалось создать инструкцию");
    } finally {
      setCreating(false);
    }
  }
  async function finishEditing() {
    await flushAllPendingSaves();
    setEditing(false);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="instruction-page">Инструкция из базы знаний</Label>
        {!value && canCreate && !disabled && (
          <button
            type="button"
            className="text-[13px] text-brand hover:underline disabled:opacity-50"
            disabled={creating}
            onClick={() => void create()}
          >
            {creating ? "Создаём…" : "Новая инструкция"}
          </button>
        )}
        {selected && !editing && (
          <a
            href={`/knowledge/${selected.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-brand hover:underline"
          >
            Открыть в базе знаний
          </a>
        )}
      </div>
      <Combobox
        id="instruction-page"
        options={options}
        value={value}
        onChange={(id) => {
          setEditing(false);
          onChange(id);
        }}
        allowClear
        clearLabel="Без инструкции"
        placeholder={loadingPages ? "Загружаем страницы…" : "Без инструкции"}
        searchPlaceholder="Найти страницу"
        emptyText="Страница не найдена"
        disabled={disabled || !canView || loadingPages || editing}
      />
      <p className="text-xs text-muted-foreground">
        Сотрудник увидит инструкцию внутри задания.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {pagesError && (
        <p role="alert" className="text-sm text-destructive">
          Не удалось загрузить список страниц. Откройте редактор задачи ещё раз.
        </p>
      )}
      {instruction && (
        <div className="min-w-0 space-y-3 pt-2">
          <div className="min-w-0 rounded-lg border p-3">
            {editing && pageMeta ? (
              <InstructionEditor instruction={instruction} meta={pageMeta} />
            ) : (
              <InstructionBody instruction={instruction} kbAccess={canView} />
            )}
          </div>
          {canEditPage && !disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (editing ? void finishEditing() : setEditing(true))}
            >
              {editing ? (
                <>
                  <Check className="size-4" />
                  Готово
                </>
              ) : (
                <>
                  <Pencil className="size-4" />
                  Редактировать инструкцию
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Правка инструкции прямо в задаче: тот же редактор и то же автосохранение,
 * что на странице базы знаний, без комментариев и меню страницы.
 */
function InstructionEditor({
  instruction,
  meta,
}: {
  instruction: TaskInstruction;
  meta: { icon: string | null; icon_color: string | null };
}) {
  const { commitContent } = useKbAutosave({
    pageId: instruction.page_id,
    commentsBundle: null,
    canEdit: true,
    canComment: false,
    initialTitle: instruction.title,
    initialIcon: meta.icon,
    initialIconColor: meta.icon_color,
    initialContent: instruction.content,
  });
  const save = useKbSaveState();
  const pageId = instruction.page_id;
  return (
    <div className="space-y-2">
      <Reader
        key={pageId}
        pageId={pageId}
        initialContent={instruction.content}
        editable
        onChange={({ content }) => commitContent(content)}
        uploadFile={async (file) => {
          const result = await uploadKbAttachment({
            pageId,
            file,
            name: file.name,
            mime_type: file.type || "application/octet-stream",
          });
          if (result.error || !result.storage_path) {
            toast.error(`Не удалось загрузить файл: ${result.error}`);
            throw new Error(result.error ?? "upload failed");
          }
          return `kbfile://${result.storage_path}`;
        }}
        resolveFileUrl={async (url) =>
          url.startsWith("kbfile://")
            ? ((await getKbAttachmentSignedUrl(url.slice(9))).url ?? "")
            : url
        }
      />
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {save.kind === "saving"
          ? "Сохраняем…"
          : save.kind === "pending"
            ? "Не сохранено"
            : save.kind === "error"
              ? "Не удалось сохранить. Изменения повторим при следующей правке"
              : save.kind === "saved"
                ? "Сохранено в базе знаний"
                : "Текст сохраняется в базе знаний сам"}
      </p>
    </div>
  );
}
