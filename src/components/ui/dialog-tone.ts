/**
 * Логика окон без JSX: тон значка, сочетание ⌘↵ и перевод готовых таблиц
 * «что затронет действие» в список последствий. Правила —
 * `docs/design-system.md`, «Modal».
 */

/**
 * Тон окна. Красный — удаление и любое необратимое; жёлтый — обратимо,
 * но с последствиями (архив, отказ, отзыв); синий — всё остальное.
 */
export type DialogTone = "default" | "warning" | "destructive";

export function resolveDialogTone(p: {
  destructive?: boolean;
  tone?: DialogTone;
}): DialogTone {
  if (p.destructive) return "destructive";
  return p.tone ?? "default";
}

/** Подложка и цвет значка — тот же рецепт, что у статусных бейджей. */
export const DIALOG_TONE_ICON_CLASS: Record<DialogTone, string> = {
  default: "bg-brand/10 text-brand",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  destructive: "bg-destructive/10 text-destructive",
};

/**
 * Выключенная главная кнопка в окне остаётся своего цвета, бледнее: серая
 * на серой полосе кнопок «пропадает». Вне окон действует общее правило
 * `disabled:bg-muted`. tailwind-merge в `Button` заменяет его этими классами.
 */
export const DIALOG_CTA_DISABLED_CLASS: Record<DialogTone, string> = {
  default: "disabled:bg-brand disabled:text-brand-foreground disabled:opacity-40",
  warning: "disabled:bg-brand disabled:text-brand-foreground disabled:opacity-40",
  destructive:
    "disabled:bg-destructive disabled:text-destructive-foreground disabled:opacity-40",
};

export type HotkeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
};

/** ⌘↵ на Mac, Ctrl+↵ на Windows и Linux; не во время набора через IME. */
export function isConfirmHotkey(e: HotkeyEventLike): boolean {
  if (e.isComposing) return false;
  if (e.key !== "Enter") return false;
  if (e.altKey || e.shiftKey) return false;
  return e.metaKey || e.ctrlKey;
}

/** Необратимое случайным ⌘↵ не подтверждается. */
export function hotkeyAllowed(tone: DialogTone): boolean {
  return tone !== "destructive";
}

export function canConfirm(s: {
  busy?: boolean;
  confirmDisabled?: boolean;
  restricted?: boolean;
}): boolean {
  return !s.busy && !s.confirmDisabled && !s.restricted;
}

/** Глагол для подсказки «⌘ ↵ перевести»: первое слово подписи кнопки. */
export function hotkeyVerb(confirmLabel: string): string {
  const first = confirmLabel.trim().split(/\s+/)[0] ?? "";
  return first.toLocaleLowerCase("ru");
}

export type ConsequenceKind =
  | "info"
  | "keep"
  | "remove"
  | "unlink"
  | "archive"
  | "irreversible";

export type ConsequenceData = { kind: ConsequenceKind; text: string; count?: number };

const IRREVERSIBLE: ConsequenceData = {
  kind: "irreversible",
  text: "Удаление нельзя отменить",
};

export function deleteImpactToConsequences(
  impact: { label: string; count: number; tone: "cascade" | "unbind" }[],
): ConsequenceData[] {
  const visible = impact.filter((row) => row.count > 0);
  const cascade = visible
    .filter((row) => row.tone === "cascade")
    .map((row): ConsequenceData => ({
      kind: "remove",
      text: `${row.label}: удалится вместе с записью`,
      count: row.count,
    }));
  const unbind = visible
    .filter((row) => row.tone === "unbind")
    .map((row): ConsequenceData => ({
      kind: "unlink",
      text: `${row.label}: отвяжется, но сохранится`,
      count: row.count,
    }));
  return [...cascade, ...unbind, IRREVERSIBLE];
}

export function archiveImpactToConsequences(
  impact: { label: string; count: number }[],
): ConsequenceData[] {
  return impact
    .filter((row) => row.count > 0)
    .map((row) => ({
      kind: "archive",
      text: `${row.label}: сохранится в архиве`,
      count: row.count,
    }));
}
