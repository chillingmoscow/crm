"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { filePreviewKind, fileKindLabel, formatFileSize } from "@/lib/files/file-name";
import { getFileSignedUrl } from "@/lib/files/signed-urls";
import type { CounterpartyDocument } from "./counterparty-documents";

/**
 * Документ контрагента крупно: PDF — встроенным просмотрщиком браузера по
 * подписанной ссылке, фото — постоянным адресом, остальное — скачать.
 */
export function DocumentPreviewDialog({
  document,
  onOpenChange,
  onDownload,
}: {
  /** null — окно закрыто. */
  document: CounterpartyDocument | null;
  onOpenChange: (open: boolean) => void;
  onDownload: (document: CounterpartyDocument) => void;
}) {
  const kind = document ? filePreviewKind(document.mimeType) : "none";
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const fileId = document?.fileId ?? null;
  useEffect(() => {
    setPdfUrl(null);
    setPdfError(null);
    if (!fileId || kind !== "pdf") return;
    let active = true;
    getFileSignedUrl(fileId)
      .then(({ url, error }) => {
        if (!active) return;
        if (url) setPdfUrl(url);
        else setPdfError(error ?? "Не удалось открыть файл");
      })
      .catch(() => {
        if (active) setPdfError("Нет связи с сервером. Проверьте соединение и повторите");
      });
    return () => {
      active = false;
    };
  }, [fileId, kind]);

  const openInTab = () => {
    if (kind === "image" && document?.imageUrl) {
      window.open(document.imageUrl, "_blank", "noopener,noreferrer");
    } else if (pdfUrl) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90dvh,900px)] max-w-4xl flex-col gap-4">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="truncate" data-tip={document?.name}>
            {document?.name}
          </DialogTitle>
          <DialogDescription>
            {document ? `${fileKindLabel(document.mimeType, document.name)} · ${formatFileSize(document.sizeBytes)}` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {kind === "pdf" ? (
            pdfUrl ? (
              <iframe src={pdfUrl} title={document?.name ?? "Документ"} className="size-full border-0" />
            ) : pdfError ? (
              <p role="alert" className="px-4 text-center text-sm text-destructive">
                {pdfError}
              </p>
            ) : (
              <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" />
                Открываем документ…
              </span>
            )
          ) : kind === "image" && document?.imageUrl ? (
            // Постоянный адрес /api/media: оптимизатор next/image его не ждёт.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={document.imageUrl} alt={document.name} className="size-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-muted-foreground">
              <FileText className="size-6" aria-hidden />
              Предпросмотр для этого файла недоступен
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {kind !== "none" ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={openInTab}
              disabled={kind === "pdf" && !pdfUrl}
            >
              <ExternalLink className="size-4" />
              Открыть в новой вкладке
            </Button>
          ) : null}
          <Button
            type="button"
            className="gap-2"
            onClick={() => (document ? onDownload(document) : undefined)}
          >
            <Download className="size-4" />
            Скачать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
