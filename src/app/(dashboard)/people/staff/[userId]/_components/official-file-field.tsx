"use client";

import { useId, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { STAFF_DOCUMENT_ACCEPT, staffDocumentProblem } from "@/lib/people/staff-document-name";
import { uploadStaffDocument } from "@/lib/people/staff-document-upload";

/** Куда и под каким списком документов загружать файл договора. */
export type OfficialDocumentTarget = {
  venueId: string;
  userId: string;
  accountId: string;
  /** Текущий список «Документов» сотрудника (для сравнения при добавлении). */
  documentPaths: string[];
  onDocumentsChange: (paths: string[]) => void;
};

/**
 * Загрузка файла договора в «Документы» один раз: если файл уже загружен,
 * а следующий шаг (команда оформления) не прошёл, повтор берёт тот же путь
 * и не создаёт второй документ.
 */
export function useOfficialDocumentUpload(target: OfficialDocumentTarget) {
  const uploaded = useRef<{ file: File; name: string; path: string } | null>(null);
  return async (file: File, name: string): Promise<string> => {
    if (uploaded.current?.file === file && uploaded.current.name === name) return uploaded.current.path;
    const { path, paths } = await uploadStaffDocument({
      venueId: target.venueId,
      userId: target.userId,
      accountId: target.accountId,
      name,
      file,
      expectedPaths: target.documentPaths,
    });
    target.onDocumentsChange(paths);
    uploaded.current = { file, name, path };
    return path;
  };
}

/**
 * Поле «прикрепить файл» в панели: кнопка выбора, выбранный файл с
 * крестиком, подсказка, ошибка формата. Форматы — как в «Документах».
 */
export function OfficialFileField({
  label,
  file,
  onChange,
  hint,
  attached,
  disabled,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  hint?: string;
  /** У записи уже есть файл: новый заменит его. */
  attached?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {file ? (
        <div className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="touch-target size-8 shrink-0"
            aria-label="Убрать файл"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button id={id} type="button" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
            <Paperclip className="size-4" />
            {attached ? "Заменить файл" : "Прикрепить файл"}
          </Button>
          {attached && <span className="text-xs text-muted-foreground">Файл уже прикреплён</span>}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={STAFF_DOCUMENT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = "";
          if (!next) return;
          const problem = staffDocumentProblem(next, "Документ");
          setError(problem);
          if (!problem) onChange(next);
        }}
      />
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
