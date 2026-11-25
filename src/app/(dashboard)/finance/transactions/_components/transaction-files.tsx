"use client";

import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from "react";
import { FileText, Loader2, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Skeleton } from "@/components/ui/skeleton";
import { fileLabelFocusClass } from "@/components/ui/field-styles";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  deleteTransactionFile,
  listTransactionFiles,
  uploadTransactionFile,
  type TransactionFile,
} from "@/lib/finance/transaction-files";
import { MAX_FILE_BYTES, fileKindLabel, formatFileSize } from "@/lib/files/file-name";
import { formatDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";


/**
 * Раздел «Файлы» в панели операции: чеки, счета, акты.
 *
 * - У сохранённой операции файлы загружаются сразу и сразу удаляются (с
 *   подтверждением: удаление безвозвратное).
 * - У новой операции файлы копятся в очереди и прикрепляются после
 *   создания — это делает панель (`pending` / `onPendingChange`).
 */
export function TransactionFiles({
  transactionId,
  pending,
  onPendingChange,
  canUpload,
  canDelete,
  onChanged,
}: {
  /** null — операция ещё не создана: работаем с очередью. */
  transactionId: string | null;
  pending: File[];
  onPendingChange: (files: File[]) => void;
  canUpload: boolean;
  canDelete: boolean;
  /** Файлы операции изменились: список страницы обновляет значок. */
  onChanged: () => void;
}) {
  const [files, setFiles] = useState<TransactionFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<TransactionFile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!transactionId) return;
    let active = true;
    setFiles(null);
    setLoadError(null);
    listTransactionFiles(transactionId)
      .then(({ files: list, error }) => {
        if (!active) return;
        if (error) setLoadError(error);
        else setFiles(list);
      })
      .catch(() => {
        if (active) setLoadError("Не удалось загрузить файлы");
      });
    return () => {
      active = false;
    };
  }, [transactionId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const addFiles = async (list: FileList | File[] | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    setActionError(null);
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = picked.filter((f) => f.size <= MAX_FILE_BYTES);
    if (tooBig.length)
      setActionError(
        `Больше 49 МБ, не прикреплены: ${tooBig.map((f) => `«${f.name}»`).join(", ")}`,
      );
    if (ok.length === 0) return;

    if (!transactionId) {
      onPendingChange([...pending, ...ok]);
      return;
    }
    setUploading(ok.map((f) => f.name));
    const failed: string[] = [];
    let lastError = "";
    for (const file of ok) {
      const { error } = await uploadTransactionFile(transactionId, file).catch(() => ({
        error: "Нет связи с сервером. Проверьте соединение и повторите",
      }));
      if (error) {
        failed.push(file.name);
        lastError = error;
      }
      setUploading((names) => names.filter((n) => n !== file.name));
    }
    if (failed.length) setActionError(`${lastError}${failed.length > 1 ? ` (${failed.length} файла)` : ""}`);
    if (failed.length < ok.length) {
      reload();
      onChanged();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !transactionId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const { error } = await deleteTransactionFile(transactionId, deleteTarget.fileId).catch(
      () => ({ error: "Нет связи с сервером. Проверьте соединение и повторите" }),
    );
    setDeleteBusy(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    setDeleteTarget(null);
    setFiles((list) => list?.filter((f) => f.fileId !== deleteTarget.fileId) ?? null);
    onChanged();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (canUpload) void addFiles(event.dataTransfer.files);
  };

  const saved = transactionId ? (files ?? []) : [];
  const loading = !!transactionId && files === null && !loadError;
  const empty = !loading && saved.length === 0 && pending.length === 0 && uploading.length === 0;

  return (
    <DrawerSection title="Файлы" className="mt-9">
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="min-w-0 flex-1">{loadError}</p>
          <Button variant="outline" size="sm" className="h-8" onClick={reload}>
            Повторить
          </Button>
        </div>
      ) : null}

      {loading ? (
        <ul className="space-y-2" role="status" aria-label="Загружаем файлы">
          {[0, 1].map((i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Skeleton className="size-10 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {saved.length > 0 || pending.length > 0 || uploading.length > 0 ? (
        <ul className="space-y-2">
          {saved.map((file) => (
            <FileRow
              key={file.fileId}
              name={file.name}
              meta={[fileKindLabel(file.mimeType, file.name), formatFileSize(file.sizeBytes), formatDayMonth(file.uploadedAt)]
                .filter(Boolean)
                .join(" · ")}
              previewUrl={file.mimeType.startsWith("image/") ? file.url : null}
              href={file.url}
              action={
                canDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="touch-target size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Удалить файл «${file.name}»`}
                    data-tip="Удалить файл"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(file);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null
              }
            />
          ))}
          {pending.map((file, index) => (
            <FileRow
              key={`${file.name}-${index}`}
              name={file.name}
              meta={[fileKindLabel(file.type, file.name), formatFileSize(file.size)].filter(Boolean).join(" · ")}
              previewUrl={null}
              href={null}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="touch-target size-8 text-muted-foreground"
                  aria-label={`Убрать файл «${file.name}»`}
                  data-tip="Убрать"
                  onClick={() => onPendingChange(pending.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              }
            />
          ))}
          {uploading.map((name) => (
            <FileRow
              key={`uploading-${name}`}
              name={name}
              meta="Загружаем…"
              previewUrl={null}
              href={null}
              busy
            />
          ))}
        </ul>
      ) : null}

      {empty && !canUpload && !loadError ? (
        <p className="text-sm text-muted-foreground">Файлов нет</p>
      ) : null}

      {canUpload ? (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            fileLabelFocusClass,
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center text-sm transition-colors",
            dragOver ? "border-brand bg-brand/5" : "border-border hover:bg-muted/40",
          )}
        >
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Upload className="size-4 text-muted-foreground" aria-hidden />
          {/* На сенсорном экране перетаскивать некуда — только выбор файла. */}
          <span className="font-medium [@media(pointer:coarse)]:hidden">
            Перетащите чек или счёт сюда или <span className="text-brand">выберите файл</span>
          </span>
          <span className="hidden font-medium text-brand [@media(pointer:coarse)]:inline">
            Прикрепить чек, счёт или фото
          </span>
          <span className="text-xs text-muted-foreground">
            {transactionId
              ? "До 49 МБ: фото, PDF, документы"
              : "Файлы прикрепятся, когда операция будет создана"}
          </span>
        </label>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteTarget(null);
        }}
        title={deleteTarget ? `Удалить файл «${deleteTarget.name}»?` : "Удалить файл?"}
        description="Файл удалится насовсем: вернуть его не получится."
        confirmLabel="Удалить файл"
        pendingLabel="Удаляем…"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />
    </DrawerSection>
  );
}

function FileRow({
  name,
  meta,
  previewUrl,
  href,
  action,
  busy = false,
}: {
  name: string;
  meta: string;
  previewUrl: string | null;
  href: string | null;
  action?: ReactNode;
  busy?: boolean;
}) {
  const thumb = (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка хранилища на час, оптимизатор Next её не обработает
        <img src={previewUrl} alt="" className="size-full object-cover" />
      ) : (
        <FileText className="size-4" />
      )}
    </span>
  );
  return (
    <li className="flex items-center gap-3 rounded-lg border px-3 py-2">
      {thumb}
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium transition-colors duration-200 hover:text-brand"
            data-tip={name}
          >
            {name}
          </a>
        ) : (
          <span className="block truncate text-sm font-medium" data-tip={name}>
            {name}
          </span>
        )}
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </div>
      {action}
    </li>
  );
}
