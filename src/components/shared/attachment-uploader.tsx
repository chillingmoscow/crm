"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Download,
  File as FileIcon,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  uploadAndAttach,
  detachFromTransaction,
  detachFromCounterparty,
  detachFromLegalEntity,
  type AttachmentParent,
} from "@/lib/files/attachments";
import { deleteAccountFile } from "@/lib/files/upload";
import { getFileSignedUrl } from "@/lib/files/signed-urls";
import type { AttachmentDocumentType } from "@/types/database";

export type AttachmentRowDisplay = {
  fileId: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  /** Human label for the document type (Договор / Чек / etc.). */
  document_type_label?: string | null;
};

type Props = {
  parent: AttachmentParent;
  attachments: AttachmentRowDisplay[];
  /** Default document_type sent on upload. */
  defaultDocumentType?: AttachmentDocumentType;
  /**
   * When true, hides every write action (upload, detach, hard-delete).
   * Use for soft-deleted parents or "no manage rights at all" callers.
   */
  readOnly?: boolean;
  /**
   * Granular gates so the page can hide a single button when the
   * underlying RLS rejects it. Each defaults to true. RLS still enforces
   * authorisation server-side — these flags only prevent guaranteed-error
   * click paths, e.g. a manager with `upload_attachments` but without
   * `delete_attachments` shouldn't see Detach (the pivot delete policy
   * gates on `finance.delete_attachments`).
   */
  canUpload?: boolean;
  canDetach?: boolean;
  canHardDelete?: boolean;
  /** Optional accept list passed to the file input. */
  accept?: string;
};

const KB = 1024;
const MB = 1024 * 1024;

/**
 * Generic file uploader used across Finance + Org. Lists existing
 * attachments for a parent (transaction / counterparty / legal entity)
 * and lets the user upload new files via a single button.
 *
 * Authorisation is enforced server-side by RLS — see migration 045.
 * The component reflects RLS errors via toast.
 */
export function AttachmentUploader({
  parent,
  attachments,
  defaultDocumentType,
  readOnly = false,
  canUpload = true,
  canDetach = true,
  canHardDelete = true,
  accept,
}: Props) {
  // Effective per-button visibility. readOnly trumps everything; otherwise
  // each gate independently hides its button.
  const showUpload     = !readOnly && canUpload;
  const showDetach     = !readOnly && canDetach;
  const showHardDelete = !readOnly && canHardDelete;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [isUploading, startUpload]  = useTransition();

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    startUpload(async () => {
      const { error } = await uploadAndAttach({
        parent,
        file,
        document_type: defaultDocumentType,
      });
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Файл прикреплён");
      router.refresh();
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDetach = (fileId: string) => {
    setBusyFileId(fileId);
    void (async () => {
      let error: string | null = null;
      switch (parent.kind) {
        case "transaction":
          ({ error } = await detachFromTransaction({ transactionId: parent.id, fileId }));
          break;
        case "counterparty":
          ({ error } = await detachFromCounterparty({ counterpartyId: parent.id, fileId }));
          break;
        case "legal_entity":
          ({ error } = await detachFromLegalEntity({ legalEntityId: parent.id, fileId }));
          break;
      }
      setBusyFileId(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Файл откреплён");
      router.refresh();
    })();
  };

  const handleHardDelete = (fileId: string) => {
    setBusyFileId(fileId);
    void (async () => {
      const { error } = await deleteAccountFile(fileId);
      setBusyFileId(null);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Файл удалён безвозвратно");
      router.refresh();
    })();
  };

  const handleDownload = (fileId: string) => {
    setBusyFileId(fileId);
    void (async () => {
      const { url, error } = await getFileSignedUrl(fileId);
      setBusyFileId(null);
      if (error || !url) {
        toast.error(error ?? "Не удалось получить ссылку");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    })();
  };

  return (
    <div className="space-y-3">
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Файлы пока не прикреплены.
        </p>
      ) : (
        <ul className="divide-y rounded-md border bg-background">
          {attachments.map((att) => (
            <li
              key={att.fileId}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="flex items-center gap-3 min-w-0">
                {isImageMime(att.mime_type) ? (
                  <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm">{att.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatSize(att.size_bytes)}
                    {att.document_type_label ? ` • ${att.document_type_label}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(att.fileId)}
                  disabled={busyFileId === att.fileId}
                  data-tip="Открыть"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {showDetach && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDetach(att.fileId)}
                    disabled={busyFileId === att.fileId}
                    data-tip="Открепить"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {showHardDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleHardDelete(att.fileId)}
                    disabled={busyFileId === att.fileId}
                    data-tip="Удалить файл навсегда"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showUpload && (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Загрузить файл
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function formatSize(bytes: number): string {
  if (bytes < KB) return `${bytes} Б`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} КБ`;
  return `${(bytes / MB).toFixed(2)} МБ`;
}
