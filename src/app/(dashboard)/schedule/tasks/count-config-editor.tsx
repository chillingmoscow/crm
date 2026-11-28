"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronsUpDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ProfileSection,
  ProfileSectionAddButton,
} from "@/components/shared/profile-section";
import {
  DEFAULT_TOBACCO_SECTIONS,
  type CountConfig,
  type CountSection,
  type Tare,
} from "@/lib/stock-count/tobacco-weighing";
import {
  loadCountOptions,
  searchCountProducts,
  type CountOptions,
} from "./actions";

const NO_CHAT = "__none";
type Product = { id: string; name: string };

/** Что не так с настройкой — текст для пользователя или null, если всё заполнено. */
export function countConfigProblem(config: CountConfig): string | null {
  if (!config.storeId) return "Выберите склад взвешивания";
  if (!config.sections.length) return "Нажмите «Заполнить по умолчанию» и выберите позиции";
  for (const section of config.sections) {
    if (!section.productId)
      return `Выберите позицию каталога для раздела «${section.title}»`;
    if (section.tares.some((t) => !t.title.trim() || !t.grams))
      return `Заполните название и вес тары в разделе «${section.title}»`;
  }
  return null;
}

function ProductPicker({
  id,
  value,
  name,
  onPick,
  disabled,
}: {
  id: string;
  value: string;
  name: string | null;
  onPick: (product: Product) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = query.trim();
    if (!open || !text) {
      setFound([]);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const r = await searchCountProducts(text);
        if (mine !== seq.current) return;
        if (r.ok) setFound(r.data);
        else toast.error(r.error);
      } catch {
        if (mine === seq.current) toast.error("Не удалось найти позиции");
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span className="truncate">
            {value ? (name ?? "Позиция выбрана") : "Выберите позицию каталога"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Название позиции"
          />
          <CommandList>
            <CommandEmpty>
              {busy
                ? "Ищем…"
                : query.trim()
                  ? "Ничего не найдено"
                  : "Начните вводить название"}
            </CommandEmpty>
            <CommandGroup>
              {found.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onPick(p);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SectionEditor({
  section,
  productName,
  onChange,
  onPick,
  disabled,
}: {
  section: CountSection;
  productName: string | null;
  onChange: (patch: Partial<CountSection>) => void;
  onPick: (product: Product) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const tare = (key: string, patch: Partial<Tare>) =>
    onChange({
      tares: section.tares.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    });
  return (
    <ProfileSection
      title={section.title}
      actions={
        disabled ? undefined : (
          <ProfileSectionAddButton
            onClick={() =>
              onChange({
                tares: [
                  ...section.tares,
                  {
                    key: `tare_${crypto.randomUUID().slice(0, 8)}`,
                    title: "",
                    grams: 0,
                  },
                ],
              })
            }
          >
            Добавить тару
          </ProfileSectionAddButton>
        )
      }
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-product`}>Позиция каталога</Label>
        <ProductPicker
          id={`${id}-product`}
          value={section.productId}
          name={productName}
          onPick={onPick}
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-hint`}>Подсказка сотруднику</Label>
        <Textarea
          id={`${id}-hint`}
          rows={3}
          value={section.hint}
          onChange={(e) => onChange({ hint: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Тара</Label>
        {section.tares.length ? (
          <div className="space-y-2">
            {section.tares.map((t) => (
              <div key={t.key} className="flex items-center gap-2">
                <Input
                  aria-label="Название тары"
                  className="min-w-0 flex-1"
                  value={t.title}
                  maxLength={60}
                  placeholder="Название"
                  onChange={(e) => tare(t.key, { title: e.target.value })}
                />
                <Input
                  aria-label="Вес тары, г"
                  className="w-24 shrink-0"
                  inputMode="numeric"
                  value={t.grams ? String(t.grams) : ""}
                  placeholder="г"
                  onChange={(e) =>
                    tare(t.key, {
                      grams: Math.min(
                        5000,
                        Number(e.target.value.replace(/\D/g, "").slice(0, 4)) || 0,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={`Удалить тару «${t.title || "без названия"}»`}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ tares: section.tares.filter((x) => x.key !== t.key) })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Тары нет</p>
        )}
      </div>
    </ProfileSection>
  );
}

export function CountConfigEditor({
  value,
  onChange,
  disabled,
}: {
  value: CountConfig | null;
  onChange: (config: CountConfig | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [options, setOptions] = useState<CountOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const initialIds = useRef(value?.sections.map((s) => s.productId).filter(Boolean) ?? []);
  useEffect(() => {
    let alive = true;
    loadCountOptions(initialIds.current)
      .then((r) => {
        if (!alive) return;
        if (!r.ok) return setLoadError(r.error);
        setOptions(r.data);
        setNames((prev) => ({
          ...Object.fromEntries(r.data.products.map((p) => [p.id, p.name])),
          ...prev,
        }));
      })
      .catch(() => alive && setLoadError("Не удалось загрузить склады и позиции"));
    return () => {
      alive = false;
    };
  }, []);

  const fillDefaults = () =>
    onChange({
      mode: "tobacco_weighing",
      storeId: value?.storeId ?? (options?.stores.length === 1 ? options.stores[0].id : ""),
      telegramChatId: value?.telegramChatId ?? null,
      sections: DEFAULT_TOBACCO_SECTIONS.map((s) => ({
        ...s,
        tares: s.tares.map((t) => ({ ...t })),
        productId: value?.sections.find((x) => x.key === s.key)?.productId ?? "",
      })),
    });
  const patch = (next: Partial<CountConfig>) =>
    onChange({
      mode: "tobacco_weighing",
      storeId: "",
      telegramChatId: null,
      sections: [],
      ...value,
      ...next,
    });
  const patchSection = (key: string, change: Partial<CountSection>) =>
    value &&
    patch({
      sections: value.sections.map((s) => (s.key === key ? { ...s, ...change } : s)),
    });

  if (loadError)
    return <p className="text-sm text-destructive">{loadError}</p>;
  const chats = options?.chats ?? [];
  // Чат, которого нет в списке (архивный), остаётся выбранным, чтобы не пропасть молча.
  const chatId = value?.telegramChatId ?? null;
  const orphanChat = chatId && !chats.some((c) => c.chatId === chatId);
  return (
    <div className="space-y-5">
      <ProfileSection
        title="Взвешивание"
        description="Склад, откуда берётся остаток, и чат для отчёта о результате."
        actions={
          disabled ? undefined : (
            <Button type="button" variant="outline" size="sm" onClick={fillDefaults}>
              Заполнить по умолчанию
            </Button>
          )
        }
      >
        <div className="space-y-2">
          <Label htmlFor={`${id}-store`}>Склад</Label>
          <Select
            value={value?.storeId || undefined}
            onValueChange={(storeId) => patch({ storeId })}
            disabled={disabled || !options}
          >
            <SelectTrigger id={`${id}-store`} className="w-full">
              <SelectValue
                placeholder={options ? "Выберите склад" : "Загрузка…"}
              />
            </SelectTrigger>
            <SelectContent>
              {(options?.stores ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options && !options.stores.length && (
            <p className="text-[13px] text-muted-foreground">
              У этого заведения нет складов. Привяжите склад к заведению в разделе «Склады».
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-chat`}>Чат Telegram для отчёта</Label>
          <Select
            value={chatId ?? NO_CHAT}
            onValueChange={(next) =>
              patch({ telegramChatId: next === NO_CHAT ? null : next })
            }
            disabled={disabled || !options}
          >
            <SelectTrigger id={`${id}-chat`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CHAT}>Не отправлять</SelectItem>
              {orphanChat && <SelectItem value={chatId}>{chatId}</SelectItem>}
              {chats.map((c) => (
                <SelectItem key={c.chatId} value={c.chatId}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ProfileSection>
      {value?.sections.map((section) => (
        <SectionEditor
          key={section.key}
          section={section}
          productName={names[section.productId] ?? null}
          disabled={disabled}
          onChange={(change) => patchSection(section.key, change)}
          onPick={(product) => {
            setNames((prev) => ({ ...prev, [product.id]: product.name }));
            patchSection(section.key, { productId: product.id });
          }}
        />
      ))}
    </div>
  );
}
