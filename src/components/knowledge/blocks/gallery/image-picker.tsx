"use client";

import { useRef, useState } from "react";

import { Link as LinkIcon, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  extractImageUrlsFromText,
  isLikelyImageUrl,
} from "@/lib/knowledge/gallery";

export function GalleryImagePicker({
  canUpload,
  mode,
  multiple = true,
  onFiles,
  onUrls,
}: {
  canUpload: boolean;
  mode: "add" | "replace";
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  onUrls: (urls: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "url">(
    canUpload ? "upload" : "url",
  );
  const [urlValue, setUrlValue] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const submitUrl = () => {
    const urls = extractImageUrlsFromText(urlValue);
    if (urls.length === 0 && isLikelyImageUrl(urlValue)) {
      urls.push(urlValue.trim());
    }
    if (urls.length === 0) {
      toast.error("Вставьте прямую ссылку на JPG, PNG, GIF или WEBP");
      return;
    }
    onUrls(multiple ? urls : urls.slice(0, 1));
    setUrlValue("");
  };

  const pickFiles = (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    const nextFiles = multiple ? files : files.slice(0, 1);
    if (nextFiles.length > 0) onFiles(nextFiles);
  };

  return (
    <div className="kb-file-panel kb-gallery-picker">
      <div className="kb-file-panel-tabs" role="tablist">
        {canUpload && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upload"}
            data-active={tab === "upload" || undefined}
            onClick={() => setTab("upload")}
            className="kb-file-panel-tab"
          >
            Файл
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tab === "url"}
          data-active={tab === "url" || undefined}
          onClick={() => setTab("url")}
          className="kb-file-panel-tab"
        >
          Ссылка
        </button>
      </div>

      {tab === "upload" && canUpload ? (
        <div className="kb-file-panel-body">
          <div
            className={cn("kb-file-panel-dropzone", dragOver && "is-dragover")}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              pickFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <UploadCloud className="size-7 text-muted-foreground" />
            <div className="kb-file-panel-dropzone-title">
              {mode === "replace"
                ? "Перетащите новое изображение сюда"
                : "Перетащите изображения сюда"}
            </div>
            <div className="kb-file-panel-dropzone-sub">
              {multiple
                ? "или нажмите, чтобы выбрать файлы"
                : "или нажмите, чтобы выбрать файл"}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple={multiple}
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(event) => {
                pickFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          <div className="kb-file-panel-hint">
            PNG, JPG, GIF, WEBP · до 10 МБ
          </div>
        </div>
      ) : (
        <div className="kb-file-panel-body">
          <div className="kb-gallery-picker-url">
            <LinkIcon className="size-4 text-muted-foreground" strokeWidth={1.75} />
            <Input
              type="url"
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitUrl();
                }
              }}
              placeholder="Вставьте ссылку на изображение"
              autoFocus
              className="h-10"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={submitUrl}
              disabled={!urlValue.trim()}
              size="sm"
            >
              {mode === "replace" ? "Заменить" : "Вставить"}
            </Button>
          </div>
          <div className="kb-file-panel-hint kb-file-panel-hint-multiline">
            Прямая ссылка на изображение JPG, PNG, GIF или WEBP
          </div>
        </div>
      )}
    </div>
  );
}
