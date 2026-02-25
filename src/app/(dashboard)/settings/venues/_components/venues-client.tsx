"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Building2, X, Settings2, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { VENUE_TYPES, CURRENCIES, TIMEZONES, DAYS_OF_WEEK, type DayKey } from "@/lib/constants";
import { createVenue } from "../actions";
import type { VenueRow } from "../page";
import type { VenueType, WorkingHours } from "@/types/database";

// ── Column definitions ───────────────────────────────────────
type ColKey = "name" | "type" | "address" | "phone" | "currency" | "timezone" | "halls_count" | "tables_count";

const COL_DEFS: {
  key: ColKey; label: string; width: string; required?: boolean;
}[] = [
  { key: "name",         label: "Название",      width: "1fr",   required: true },
  { key: "type",         label: "Тип",           width: "120px" },
  { key: "halls_count",  label: "Залы",          width: "70px" },
  { key: "tables_count", label: "Столы",         width: "70px" },
  { key: "address",      label: "Адрес",         width: "1fr" },
  { key: "phone",        label: "Телефон",       width: "140px" },
  { key: "currency",     label: "Валюта",        width: "80px" },
  { key: "timezone",     label: "Часовой пояс",  width: "160px" },
];

const DEFAULT_COLS: ColKey[] = ["name", "type", "halls_count", "tables_count", "address", "phone"];

function buildGrid(visible: Set<ColKey>) {
  return COL_DEFS.filter((c) => visible.has(c.key)).map((c) => c.width).join(" ");
}

const VENUE_TYPE_LABELS: Record<string, string> = {
  restaurant: "Ресторан",
  bar:        "Бар",
  cafe:       "Кафе",
  club:       "Клуб",
  other:      "Другое",
};

const INITIAL_WORKING_HOURS: WorkingHours = {
  mon: { open: "10:00", close: "22:00", closed: false },
  tue: { open: "10:00", close: "22:00", closed: false },
  wed: { open: "10:00", close: "22:00", closed: false },
  thu: { open: "10:00", close: "22:00", closed: false },
  fri: { open: "10:00", close: "23:00", closed: false },
  sat: { open: "11:00", close: "23:00", closed: false },
  sun: { open: "11:00", close: "22:00", closed: false },
};

const schema = z.object({
  name:     z.string().min(1, "Введите название"),
  type:     z.enum(["restaurant", "bar", "cafe", "club", "other"]),
  address:  z.string().optional(),
  phone:    z.string().optional(),
  currency: z.string().min(1),
  timezone: z.string().min(1),
});

type Form = z.infer<typeof schema>;

type Props = {
  venues: VenueRow[];
};

// ── Column settings dropdown ─────────────────────────────────
function ColumnSettings({ visible, onChange }: {
  visible: Set<ColKey>;
  onChange: (key: ColKey, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOpen((v) => !v)}>
        <Settings2 className="w-4 h-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-md p-2 min-w-[200px]">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-2 pb-1.5">
            Столбцы таблицы
          </p>
          {COL_DEFS.filter((c) => !c.required).map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer text-sm select-none"
            >
              <input
                type="checkbox"
                checked={visible.has(col.key)}
                onChange={(e) => onChange(col.key, e.target.checked)}
                className="accent-primary"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter dropdown ──────────────────────────────────────────
type VenueFilter = { type: string | null };

function FilterPanel({ filter, onChange }: {
  filter: VenueFilter;
  onChange: (f: VenueFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const isActive = filter.type !== null;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="icon"
        className={`h-8 w-8 ${isActive ? "border-primary text-primary" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter className="w-4 h-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-md p-3 min-w-[200px] space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Фильтры
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Тип заведения</Label>
            <select
              className="w-full h-8 rounded-md border border-input bg-background text-sm px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filter.type ?? ""}
              onChange={(e) => onChange({ type: e.target.value || null })}
            >
              <option value="">Все типы</option>
              {VENUE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {isActive && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={() => onChange({ type: null })}
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────
export function VenuesClient({ venues: initialVenues }: Props) {
  const router = useRouter();
  const [venues, setVenues] = useState(initialVenues);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [workingHours, setWorkingHours] = useState<WorkingHours>(INITIAL_WORKING_HOURS);
  const [isPending, startTransition] = useTransition();

  // Column visibility — persisted in localStorage
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    if (typeof window === "undefined") return new Set(DEFAULT_COLS);
    try {
      const saved = localStorage.getItem("crm-venues-visible-cols");
      if (saved) return new Set(JSON.parse(saved) as ColKey[]);
    } catch {}
    return new Set(DEFAULT_COLS);
  });
  const toggleCol = (key: ColKey, on: boolean) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      try { localStorage.setItem("crm-venues-visible-cols", JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const template = buildGrid(visibleCols);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchOpen]);

  // Filter
  const [filter, setFilter] = useState<VenueFilter>({ type: null });

  const { register, handleSubmit, setValue, reset, formState: { errors } } =
    useForm<Form>({
      resolver: zodResolver(schema),
      defaultValues: { type: "restaurant", currency: "RUB", timezone: "Europe/Moscow" },
    });

  function openCreate() {
    setWorkingHours(INITIAL_WORKING_HOURS);
    reset({ name: "", type: "restaurant", address: "", phone: "", currency: "RUB", timezone: "Europe/Moscow" });
    setSheetOpen(true);
  }

  const toggleDay = (day: DayKey) => {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        closed: !prev[day]?.closed,
        open:   prev[day]?.open  ?? "10:00",
        close:  prev[day]?.close ?? "22:00",
      },
    }));
  };

  const setTime = (day: DayKey, field: "open" | "close", value: string) => {
    setWorkingHours((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const onSubmit = (values: Form) => {
    startTransition(async () => {
      const result = await createVenue({
        name: values.name, type: values.type as VenueType,
        address: values.address, phone: values.phone,
        currency: values.currency, timezone: values.timezone,
        workingHours,
      });
      if (result.error) { toast.error(result.error); return; }
      toast.success("Заведение создано");
      if (result.id) {
        setVenues((prev) => [...prev, {
          id: result.id!, name: values.name, type: values.type,
          address: values.address ?? null, phone: values.phone ?? null,
          currency: values.currency, timezone: values.timezone, working_hours: workingHours,
          halls_count: 0, tables_count: 0,
        }]);
      }
      setSheetOpen(false);
    });
  };

  // ── Filtering ───────────────────────────────────────────────
  const q = searchQuery.toLowerCase().trim();
  const filteredVenues = venues.filter((v) => {
    if (q && !v.name.toLowerCase().includes(q) &&
        !(v.address ?? "").toLowerCase().includes(q) &&
        !(v.phone ?? "").toLowerCase().includes(q)) return false;
    if (filter.type && v.type !== filter.type) return false;
    return true;
  });
  const isFiltered = q.length > 0 || filter.type !== null;

  // ── Cell renderers ─────────────────────────────────────────
  const renderCell = (key: ColKey, venue: VenueRow) => {
    switch (key) {
      case "name":
        return <div className="font-medium text-sm truncate">{venue.name}</div>;
      case "type":
        return <Badge variant="secondary" className="text-xs cursor-default">{VENUE_TYPE_LABELS[venue.type] ?? venue.type}</Badge>;
      case "address":
        return <div className="text-sm text-muted-foreground truncate">{venue.address || "—"}</div>;
      case "phone":
        return <div className="text-sm text-muted-foreground truncate">{venue.phone || "—"}</div>;
      case "currency":
        return <div className="text-sm text-muted-foreground">{venue.currency}</div>;
      case "timezone":
        return <div className="text-sm text-muted-foreground truncate">{venue.timezone.split("/")[1]?.replace(/_/g, " ") ?? venue.timezone}</div>;
      case "halls_count":
        return <div className="text-sm text-muted-foreground tabular-nums">{venue.halls_count}</div>;
      case "tables_count":
        return <div className="text-sm text-muted-foreground tabular-nums">{venue.tables_count}</div>;
    }
  };

  return (
    <div className="p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Заведения</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {venues.length > 0
              ? `${venues.length} ${venues.length === 1 ? "заведение" : venues.length < 5 ? "заведения" : "заведений"}`
              : "Нет заведений"}
            {isFiltered && ` · показано ${filteredVenues.length}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="flex items-center gap-1">
            {searchOpen && (
              <div className="relative">
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск"
                  className="h-8 w-48 text-sm pr-7"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="icon"
              className={`h-8 w-8 ${searchOpen ? "border-primary text-primary" : ""}`}
              onClick={() => { if (searchOpen) setSearchQuery(""); setSearchOpen((v) => !v); }}
            >
              <Search className="w-4 h-4" />
            </Button>
          </div>

          <FilterPanel filter={filter} onChange={setFilter} />
          <ColumnSettings visible={visibleCols} onChange={toggleCol} />

          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Добавить
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {venues.length === 0 && (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-16 text-center">
          <Building2 className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Нет заведений</p>
          <p className="text-sm text-muted-foreground mt-1">Добавьте первое заведение, чтобы начать работу</p>
          <Button onClick={openCreate} size="sm" className="mt-4">
            <Plus className="w-4 h-4 mr-1.5" />
            Добавить заведение
          </Button>
        </div>
      )}

      {/* Venues table */}
      {venues.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          {/* Header */}
          <div
            className="grid gap-3 px-4 py-3 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b"
            style={{ gridTemplateColumns: template }}
          >
            {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
              <span key={col.key}>{col.label}</span>
            ))}
          </div>

          {/* Rows */}
          {filteredVenues.map((venue, i) => (
            <div key={venue.id}>
              {i > 0 && <Separator />}
              <div
                className="grid gap-3 items-center px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                style={{ gridTemplateColumns: template }}
                onClick={() => router.push(`/settings/venues/${venue.id}`)}
              >
                {COL_DEFS.filter((c) => visibleCols.has(c.key)).map((col) => (
                  <div key={col.key}>{renderCell(col.key, venue)}</div>
                ))}
              </div>
            </div>
          ))}

          {/* No results */}
          {isFiltered && filteredVenues.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Нет заведений, соответствующих фильтрам
            </div>
          )}
        </div>
      )}

      {/* Create Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Новое заведение</SheetTitle>
          </SheetHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Название *</Label>
              <Input id="name" placeholder="Ресторан «Берёзка»" {...register("name")} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Тип заведения *</Label>
              <Select defaultValue="restaurant" onValueChange={(v) => setValue("type", v as Form["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENUE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="address">Адрес</Label>
                <Input id="address" placeholder="г. Москва, ул. Пушкина, 1" {...register("address")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Телефон</Label>
                <Input id="phone" placeholder="+7 (999) 000-00-00" {...register("phone")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Валюта *</Label>
                <Select defaultValue="RUB" onValueChange={(v) => setValue("currency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Часовой пояс *</Label>
                <Select defaultValue="Europe/Moscow" onValueChange={(v) => setValue("timezone", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Часы работы</Label>
              <div className="space-y-2">
                {DAYS_OF_WEEK.map(({ key, label }) => {
                  const day = workingHours[key];
                  const isClosed = day?.closed ?? false;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-7 text-sm font-medium text-muted-foreground">{label}</span>
                      <Switch checked={!isClosed} onCheckedChange={() => toggleDay(key)} />
                      {isClosed ? (
                        <span className="text-sm text-muted-foreground">Выходной</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input type="time" value={day?.open ?? "10:00"} onChange={(e) => setTime(key, "open", e.target.value)} className="w-28 h-8 text-sm" />
                          <span className="text-muted-foreground text-sm">—</span>
                          <Input type="time" value={day?.close ?? "22:00"} onChange={(e) => setTime(key, "close", e.target.value)} className="w-28 h-8 text-sm" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={isPending}>
                Создать
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
