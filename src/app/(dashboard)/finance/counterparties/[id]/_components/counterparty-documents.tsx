"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fileLabelFocusClass } from "@/components/ui/field-styles";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { uploadAndAttach } from "@/lib/files/attachments";
import { MAX_FILE_BYTES, fileKindLabel, formatFileSize } from "@/lib/files/file-name";
import { renameCounterpartyFile } from "@/lib/files/rename";
import { getFileDownloadUrl } from "@/lib/files/signed-urls";
import { deleteAccountFile } from "@/lib/files/upload";
import { formatDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { DocumentPreviewDialog } from "./document-preview-dialog";

export type CounterpartyDocument = {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  /** mediaUrl 80×80 cover — только для картинок. */
  thumbUrl: string | null;
  /** mediaUrl до 1600 по ширине, contain — только для картинок. */
  imageUrl: string | null;
};

const OFFLINE = "Нет связи с сервером. Проверьте соединение и повторите";

/**
 * Документы контрагента: договоры, акты, счета, банковская карточка.
 * Открываются в окне предпросмотра, скачиваются под своим названием,
 * переименовываются на месте и удаляются насовсем (с подтверждением).
 */
export function CounterpartyDocuments({
  counterpartyId,
  documents,
  canUpload,
  canDelete,
  readOnly,
}: {
  counterpartyId: string;
  documents: CounterpartyDocument[];
  canUpload: boolean;
  canDelete: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const showUpload = canUpload && !readOnly;
  const showRename = canUpload && !readOnly;
  const showDelete = canDelete && !readOnly;

  const [uploading, setUploading] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [preview, setPreview] = useState<CounterpartyDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<{ fileId: string; message: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<CounterpartyDocument | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const addFiles = async (list: FileList | File[] | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    setUploadError(null);
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = picked.filter((f) => f.size <= MAX_FILE_BYTES);
    const errors: string[] = [];
    if (tooBig.length) errors.push(`Больше 49 МБ, не загружены: ${tooBig.map((f) => `«${f.name}»`).join(", ")}`);
    setUploading(ok.map((f) => f.name));
    let uploaded = 0;
    for (const file of ok) {
      const { error } = await uploadAndAttach({ parent: { kind: "counterparty", id: counterpartyId }, file }).catch(
        () => ({ error: OFFLINE }),
      );
      if (error) errors.push(`«${file.name}»: ${error}`);
      else uploaded += 1;
      setUploading((names) => names.filter((n) => n !== file.name));
    }
    if (errors.length) setUploadError(errors.join(". "));
    if (uploaded > 0) router.refresh();
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    void addFiles(event.dataTransfer.files);
  };

  const download = async (doc: CounterpartyDocument) => {
    setDownloadingId(doc.fileId);
    const { url, error } = await getFileDownloadUrl(doc.fileId).catch(() => ({ url: null, error: OFFLINE }));
    setDownloadingId(null);
    if (!url) {
      toast.error(error ?? "Не удалось скачать файл");
      return;
    }
    window.location.assign(url);
  };

  const saveName = async (doc: CounterpartyDocument, value: string) => {
    setRenameError(null);
    if (value.trim() === "" || value === doc.name) {
      setEditingId(null);
      return;
    }
    setRenamingId(doc.fileId);
    const { name, error } = await renameCounterpartyFile({
      fileId: doc.fileId,
      name: value,
    }).catch(() => ({ name: null, error: OFFLINE }));
    setRenamingId(null);
    if (error || !name) {
      setRenameError({ fileId: doc.fileId, message: error ?? "Не удалось переименовать файл" });
      return;
    }
    setEditingId(null);
    if (name !== doc.name) router.refresh();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const { error } = await deleteAccountFile(deleteTarget.fileId).catch(() => ({ error: OFFLINE }));
    setDeleteBusy(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    toast.success(`Файл «${deleteTarget.name}» удалён`);
    setDeleteTarget(null);
    router.refresh();
  };

  const empty = documents.length === 0 && uploading.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {!empty ? (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.fileId}
              doc={doc}
              editing={editingId === doc.fileId}
              renaming={renamingId === doc.fileId}
              renameError={renameError?.fileId === doc.fileId ? renameError.message : null}
              downloading={downloadingId === doc.fileId}
              showRename={showRename}
              showDelete={showDelete}
              onOpen={() => setPreview(doc)}
              onDownload={() => void download(doc)}
              onStartRename={() => {
                setRenameError(null);
                setEditingId(doc.fileId);
              }}
              onCancelRename={() => {
                setRenameError(null);
                setEditingId(null);
              }}
              onSaveName={(value) => void saveName(doc, value)}
              onDelete={() => {
                setDeleteError(null);
                setDeleteTarget(doc);
              }}
            />
          ))}
          {uploading.map((name) => (
            <li key={`uploading-${name}`} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{name}</span>
                <span className="block text-xs text-muted-foreground">Загружаем…</span>
              </div>
            </li>
          ))}
        </ul>
      ) : !showUpload ? (
        <p className="text-sm text-muted-foreground">Файлов нет</p>
      ) : null}

      {showUpload ? (
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
            Перетащите договор, акт или счёт сюда или <span className="text-brand">выберите файл</span>
          </span>
          <span className="hidden font-medium text-brand [@media(pointer:coarse)]:inline">Прикрепить файл</span>
          <span className="text-xs text-muted-foreground">До 49 МБ: PDF, фото, документы</span>
        </label>
      ) : null}

      {uploadError ? (
        <p role="alert" className="text-xs text-destructive">
          {uploadError}
        </p>
      ) : null}

      <DocumentPreviewDialog
        document={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        onDownload={(doc) => void download(doc)}
      />

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
    </div>
  );
}

function DocumentRow({
  doc,
  editing,
  renaming,
  renameError,
  downloading,
  showRename,
  showDelete,
  onOpen,
  onDownload,
  onStartRename,
  onCancelRename,
  onSaveName,
  onDelete,
}: {
  doc: CounterpartyDocument;
  editing: boolean;
  renaming: boolean;
  renameError: string | null;
  downloading: boolean;
  showRename: boolean;
  showDelete: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSaveName: (value: string) => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter и потеря фокуса обе сохраняют: сохраняем один раз.
  const settled = useRef(false);
  const meta = [fileKindLabel(doc.mimeType, doc.name), formatFileSize(doc.sizeBytes), formatDayMonth(doc.uploadedAt)]
    .filter(Boolean)
    .join(" · ");

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      settled.current = true;
      onSaveName(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      settled.current = true;
      onCancelRename();
    }
  };

  return (
    <li className="rounded-lg border px-3 py-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
          aria-label={`Открыть ${doc.name}`}
        >
          {doc.thumbUrl ? (
            // Постоянный адрес /api/media: оптимизатор next/image его не ждёт.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.thumbUrl} alt="" className="size-full object-cover" />
          ) : (
            <FileText className="size-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              ref={inputRef}
              defaultValue={doc.name}
              aria-label="Название файла"
              maxLength={200}
              disabled={renaming}
              autoFocus
              onFocus={(event) => {
                settled.current = false;
                // Выделяем название без расширения: обычно меняют его.
                const value = event.currentTarget.value;
                const dot = value.lastIndexOf(".");
                event.currentTarget.setSelectionRange(0, dot > 0 ? dot : value.length);
              }}
              onKeyDown={onKeyDown}
              onBlur={(event) => {
                if (!settled.current) onSaveName(event.currentTarget.value);
              }}
              className="h-8"
            />
          ) : (
            <button
              type="button"
              onClick={onOpen}
              className="block max-w-full truncate text-left text-sm font-medium hover:underline"
              data-tip={doc.name}
            >
              {doc.name}
            </button>
          )}
          <span className="block truncate text-xs text-muted-foreground">{renaming ? "Сохраняем…" : meta}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="touch-target size-8 text-muted-foreground"
            onClick={onDownload}
            disabled={downloading}
            aria-label={`Скачать ${doc.name}`}
            data-tip="Скачать"
          >
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          </Button>
          {showRename && !editing ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="touch-target size-8 text-muted-foreground"
              onClick={onStartRename}
              aria-label={`Переименовать ${doc.name}`}
              data-tip="Переименовать"
            >
              <Pencil className="size-4" />
            </Button>
          ) : null}
          {showDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="touch-target size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
              aria-label={`Удалить файл «${doc.name}»`}
              data-tip="Удалить файл"
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {renameError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {renameError}
        </p>
      ) : null}
    </li>
  );
}
