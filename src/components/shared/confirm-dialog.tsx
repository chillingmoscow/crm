"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  Info,
  Trash2,
  Unlink,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHotkeyHint,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIALOG_CTA_DISABLED_CLASS,
  canConfirm,
  hotkeyAllowed,
  hotkeyVerb,
  isConfirmHotkey,
  resolveDialogTone,
  type ConsequenceKind,
  type DialogTone,
} from "@/components/ui/dialog-tone";
import { cn } from "@/lib/utils";

/** Строка списка последствий: что произойдёт после подтверждения. */
export type DialogConsequence = {
  text: ReactNode;
  /** Число справа: «Смены: удалится вместе с записью — 12». */
  count?: number;
  /** Значок по смыслу строки; `irreversible` красный. */
  kind?: ConsequenceKind;
  /** Свой значок вместо значка по `kind`. */
  icon?: LucideIcon;
};

const TONE_ICON: Record<DialogTone, LucideIcon> = {
  default: Info,
  warning: AlertTriangle,
  destructive: Trash2,
};

const CONSEQUENCE_ICON: Record<ConsequenceKind, LucideIcon> = {
  info: Info,
  keep: Check,
  remove: Trash2,
  unlink: Unlink,
  archive: Archive,
  irreversible: AlertTriangle,
};

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Подпись кнопки во время выполнения: «Удаляем…». */
  pendingLabel?: string;
  /** Вторая кнопка. Всегда «Отмена», кроме «Не сохранять изменения?». */
  cancelLabel?: string;
  /** То же, что `tone="destructive"`; оставлено для существующих экранов. */
  destructive?: boolean;
  /** Тон значка и кнопки: красный — необратимо, жёлтый — внимание, синий — обычное. */
  tone?: DialogTone;
  /** Значок по смыслу действия; по умолчанию — значок тона. */
  icon?: LucideIcon;
  /**
   * Что произойдёт — списком, а не абзацем. Только то, что действие
   * действительно делает. Если список есть, описание — одна строка.
   */
  consequences?: DialogConsequence[];
  busy?: boolean;
  /** Кнопка подтверждения неактивна, пока не выполнено условие (например, не указана причина). */
  confirmDisabled?: boolean;
  /**
   * Почему действие сейчас недоступно. Показывается в теле, кнопка
   * подтверждения выключена: разрушительное действие не прячем, а объясняем.
   */
  restriction?: ReactNode;
  /** Ошибка выполнения: остаётся в диалоге, а не уходит в тост. */
  error?: ReactNode;
  onConfirm: () => void;
  /** Поля между текстом и кнопками: например, причина удаления. */
  children?: ReactNode;
};

/**
 * Подтверждение действия, которое нельзя или трудно отменить.
 * Правила — `docs/design-system.md`, «Modal»: заголовок называет объект
 * («Удалить документ „Паспорт“?»), кнопка повторяет глагол с объектом
 * («Удалить документ»), вторая кнопка — «Отмена». ⌘↵ подтверждает,
 * кроме красных (необратимых) окон.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Отмена",
  destructive = false,
  tone: toneProp,
  icon,
  consequences,
  busy = false,
  confirmDisabled = false,
  restriction,
  error,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const tone = resolveDialogTone({ destructive, tone: toneProp });
  const withHotkey = hotkeyAllowed(tone);
  const ready = canConfirm({ busy, confirmDisabled, restricted: !!restriction });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        hideClose
        onKeyDown={(event) => {
          if (!isConfirmHotkey(event)) return;
          // Сочетание забираем себе, даже когда подтвердить нельзя: иначе
          // ⌘↵ всплывёт через портал в панель или форму под окном.
          event.preventDefault();
          event.stopPropagation();
          if (withHotkey && ready) onConfirm();
        }}
      >
        <DialogHeader>
          <DialogIcon tone={tone} icon={icon ?? TONE_ICON[tone]} />
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {consequences && consequences.length > 0 ? (
          <ConsequenceList items={consequences} />
        ) : null}
        {children}
        {restriction || error ? (
          <p role="alert" className="text-sm text-destructive">
            {restriction || error}
          </p>
        ) : null}
        <DialogFooter
          hint={
            withHotkey ? (
              <DialogHotkeyHint keys={["⌘", "↵"]} label={hotkeyVerb(confirmLabel)} />
            ) : (
              <DialogHotkeyHint keys={["Esc"]} label="отмена" />
            )
          }
        >
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            className={DIALOG_CTA_DISABLED_CLASS[tone]}
            disabled={!ready}
            onClick={onConfirm}
          >
            {busy && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Список последствий отдельно — для окна, где он зависит от поля выше
 * (например, число смен от выбранной даты) и стоит после него в `children`.
 */
export function ConsequenceList({ items }: { items: DialogConsequence[] }) {
  return (
    <ul className="divide-y rounded-[10px] border text-sm">
      {items.map((item, index) => {
        const Icon = item.icon ?? CONSEQUENCE_ICON[item.kind ?? "info"];
        return (
          <li key={index} className="flex gap-2.5 px-3 py-2.5">
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-4 shrink-0",
                item.kind === "irreversible" ? "text-destructive" : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1">{item.text}</span>
            {item.count !== undefined ? (
              <span className="shrink-0 font-medium tabular-nums">{item.count}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  | "title"
  | "description"
  | "confirmLabel"
  | "destructive"
  | "tone"
  | "icon"
  | "consequences"
  | "cancelLabel"
>;

/**
 * Подтверждение из обработчика: `if (!(await confirm({...}))) return;`.
 * Замена `window.confirm`. `dialog` нужно отрисовать в компоненте.
 * Одновременно открыто одно окно: новый вызов отменяет предыдущий.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolveRef.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const dialog = options ? (
    <ConfirmDialog
      {...options}
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return { confirm, dialog };
}
