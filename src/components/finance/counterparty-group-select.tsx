"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { createCounterpartyGroup } from "@/lib/finance/counterparties";

/** Пункт-маркер: не значение, а команда «создать группу». */
const NEW_GROUP = "__new_group__";
const collator = new Intl.Collator("ru", { sensitivity: "base" });

type Group = { id: string; name: string };

/**
 * Выбор группы контрагента. Последним пунктом — «Новая группа»: открывает
 * окно с названием, создаёт группу и сразу выбирает её, не уходя в панель
 * «Группы контрагентов».
 */
export function CounterpartyGroupSelect({
  value,
  onValueChange,
  groups,
  canCreate,
  ...control
}: Omit<ComponentProps<typeof OptionSelect>, "options" | "groups" | "value" | "onValueChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  groups: Group[];
  /** Право «Управлять контрагентами» и карточка не только для чтения. */
  canCreate: boolean;
}) {
  const router = useRouter();
  const [created, setCreated] = useState<Group[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Только что созданная группа, которую надо выбрать. У Radix Select есть
  // скрытый нативный <select>: если выбрать значение раньше, чем в нём
  // появится пункт, он отвечает пустым значением и выбор сбрасывается на
  // «Без группы». Поэтому выбираем через кадр после того, как пункт добавлен.
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Свежий обработчик без перезапуска эффекта: родители передают его новой
  // стрелкой на каждой отрисовке.
  const onValueChangeRef = useRef(onValueChange);
  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  });

  const options = useMemo(() => {
    const known = new Set(groups.map((group) => group.id));
    const all = [...groups, ...created.filter((group) => !known.has(group.id))].sort((a, b) =>
      collator.compare(a.name, b.name),
    );
    return [
      { value: "", label: "Без группы" },
      ...all.map((group) => ({ value: group.id, label: group.name })),
      ...(canCreate
        ? [
            {
              value: NEW_GROUP,
              label: (
                <span className="flex items-center gap-2 text-brand">
                  <Plus className="size-4" aria-hidden />
                  Новая группа
                </span>
              ),
            },
          ]
        : []),
    ];
  }, [groups, created, canCreate]);

  useEffect(() => {
    if (!pendingId) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        onValueChangeRef.current(pendingId);
        setPendingId(null);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [pendingId]);

  const create = async () => {
    setError(null);
    setBusy(true);
    const result = await createCounterpartyGroup({ name }).catch(() => ({
      id: null,
      error: "Нет связи с сервером. Проверьте соединение и повторите",
    }));
    setBusy(false);
    if (result.error || !result.id) {
      setError(result.error ?? "Не удалось создать группу");
      return;
    }
    setCreated((list) => [...list, { id: result.id as string, name: name.trim() }]);
    setPendingId(result.id);
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <OptionSelect
        {...control}
        value={value}
        onValueChange={(next) => {
          if (next === NEW_GROUP) {
            setName("");
            setError(null);
            // Закрываясь, список возвращает фокус на себя: окно открываем
            // следующим кадром, иначе фокус уйдёт из поля «Название».
            requestAnimationFrame(() => setOpen(true));
            return;
          }
          onValueChange(next);
        }}
        options={options}
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              // Форма карточки контрагента выше по дереву: своё отправление не всплывает.
              event.stopPropagation();
              void create();
            }}
          >
            <DialogHeader>
              <DialogTitle>Новая группа</DialogTitle>
              <DialogDescription>Группа появится в списке контрагентов и в фильтре</DialogDescription>
            </DialogHeader>
            <Field id="new-counterparty-group-name" label="Название" required error={error}>
              {(field) => (
                <Input
                  {...field}
                  ref={inputRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  disabled={busy}
                />
              )}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Отмена
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Создаём…" : "Создать группу"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
