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
 * Выключенная заливная кнопка в полосе кнопок окна остаётся своего цвета,
 * бледнее (и во время выполнения): серая на серой полосе «пропадает». Вне
 * окон действует общее правило `disabled:bg-muted`. Стоит на `DialogFooter`,
 * кнопку находит по `data-variant` (его ставит `Button`); outline и ghost не
 * трогает. Селектор `.x>button[...]:disabled` сильнее `disabled:bg-muted`.
 */
export const DIALOG_FOOTER_CTA_CLASS = [
  "[&>button[data-variant=default]:disabled]:bg-brand",
  "[&>button[data-variant=default]:disabled]:text-brand-foreground",
  "[&>button[data-variant=default]:disabled]:opacity-40",
  "[&>button[data-variant=brand]:disabled]:bg-brand",
  "[&>button[data-variant=brand]:disabled]:text-brand-foreground",
  "[&>button[data-variant=brand]:disabled]:opacity-40",
  "[&>button[data-variant=destructive]:disabled]:bg-destructive",
  "[&>button[data-variant=destructive]:disabled]:text-destructive-foreground",
  "[&>button[data-variant=destructive]:disabled]:opacity-40",
].join(" ");

export type HotkeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  /** 229 — нажатие во время набора через IME (Safari шлёт его вместо isComposing). */
  keyCode?: number;
  /** Автоповтор при зажатой клавише. */
  repeat?: boolean;
};

/**
 * Поля сочетания из React-события. `isComposing` в синтетическом событии
 * React нет — он есть только у `nativeEvent`.
 */
export function hotkeyEventFrom(
  e: HotkeyEventLike & { nativeEvent: { isComposing: boolean } },
): HotkeyEventLike {
  return {
    key: e.key,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    keyCode: e.keyCode,
    repeat: e.repeat,
    isComposing: e.nativeEvent.isComposing,
  };
}

/**
 * ⌘↵ на Mac, Ctrl+↵ на Windows и Linux; не во время набора через IME и не
 * автоповтором зажатой клавиши. Из React-события — через `hotkeyEventFrom`.
 */
export function isConfirmHotkey(e: HotkeyEventLike): boolean {
  if (e.isComposing || e.keyCode === 229 || e.repeat) return false;
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

/**
 * Подпись подсказки «⌘ ↵ в архив»: короткая подпись кнопки (до трёх слов,
 * только буквы) с маленькой буквы, иначе — «подтвердить». Первое слово
 * отдельно не берём: «В архив» дало бы «в», «Не учитывать» — «не».
 */
export function hotkeyVerb(confirmLabel: string): string {
  const label = confirmLabel.trim();
  const words = label.split(/\s+/);
  if (words.length > 3 || !/^[\p{L}\s-]+$/u.test(label)) return "подтвердить";
  return label.charAt(0).toLocaleLowerCase("ru") + label.slice(1);
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

/**
 * Подписи — существительные во множественном числе («Документы», «Залы»):
 * к ним дописывается глагол «удалятся…» / «отвяжутся…».
 */
export function deleteImpactToConsequences(
  impact: { label: string; count: number; tone: "cascade" | "unbind" }[],
): ConsequenceData[] {
  const visible = impact.filter((row) => row.count > 0);
  const cascade = visible
    .filter((row) => row.tone === "cascade")
    .map((row): ConsequenceData => ({
      kind: "remove",
      text: `${row.label}: удалятся вместе с записью`,
      count: row.count,
    }));
  const unbind = visible
    .filter((row) => row.tone === "unbind")
    .map((row): ConsequenceData => ({
      kind: "unlink",
      text: `${row.label}: отвяжутся, но сохранятся`,
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
      text: `${row.label}: сохранятся в архиве`,
      count: row.count,
    }));
}
