import type { CandidateFile } from "./types";

export type CandidateFileProblem = {
  /** Что случилось — крупно на плитке файла. */
  title: string;
  /** Почему — строкой под заголовком; null, если причина неизвестна. */
  reason: string | null;
  /** Есть смысл повторить перенос: сбой мог быть временным. */
  canRetry: boolean;
  /** Неперенесённую запись можно убрать из анкеты. */
  canRemove: boolean;
};

// Тексты ошибок пишет очередь переноса (`transferCandidateFile` в jobs.ts).
// Повтор предлагаем только там, где сбой мог быть временным: адрес вне
// разрешённых хранилищ, формат и размер файла от повтора не изменятся.
const KNOWN_ERRORS: Record<string, { reason: string; canRetry: boolean }> = {
  "Адрес файла не разрешён": { reason: "Источник файла не поддерживается", canRetry: false },
  "Неподдерживаемый тип файла": { reason: "Формат файла не поддерживается", canRetry: false },
  "Файл больше 10 МБ": { reason: "Файл больше 10 МБ", canRetry: false },
  "Не удалось получить исходный файл": { reason: "Источник не отдал файл", canRetry: true },
};

/** Состояние файла анкеты, у которого ещё нет копии в хранилище. */
export function candidateFileProblem(
  file: Pick<CandidateFile, "state" | "error">,
): CandidateFileProblem | null {
  switch (file.state) {
    case "external":
      return { title: "Папка с фотографиями в Google Drive", reason: null, canRetry: false, canRemove: false };
    case "pending":
      return { title: "Переносим файл…", reason: null, canRetry: false, canRemove: false };
    case "missing":
      return { title: "Исходный файл недоступен", reason: "Файл удалён из исходного хранилища", canRetry: false, canRemove: true };
    case "error": {
      const known = file.error ? KNOWN_ERRORS[file.error] : undefined;
      return {
        title: "Не удалось перенести файл",
        reason: known?.reason ?? null,
        canRetry: known?.canRetry ?? true,
        canRemove: true,
      };
    }
    default:
      return null;
  }
}
