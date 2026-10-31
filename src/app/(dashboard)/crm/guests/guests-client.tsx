"use client";
/* eslint-disable @next/next/no-img-element -- Private signed photo URLs are served directly, never cached by the image optimizer. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Settings2,
  RefreshCw,
  Camera,
  Archive,
  RotateCcw,
  ArrowUpDown,
  Cake,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { PageFrame } from "@/components/shared/page-frame";
import {
  TablePageHeader,
  TableControls,
  TablePagination,
} from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatGuestBirthday } from "@/lib/guests/source";
import {
  defaultGuestRules,
  guestFields,
  guestHistoryActions,
  type GuestList,
  type GuestDetail,
  type Guest,
  type GuestEditable,
  type GuestFilters,
  type GuestConfiguration,
} from "@/lib/guests/types";
import {
  loadGuests,
  loadGuest,
  saveGuest,
  uploadGuestPhoto,
  guestConfiguration,
  saveGuestRules,
  readGuests,
} from "./actions";
const initialFilters: GuestFilters = {
  search: "",
  group: "",
  birthday: "",
  archived: false,
  page: 0,
  size: 25,
  sort: "name",
  desc: false,
};
const dateTime = (v: string) =>
  new Date(v).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
function birthday(g: Guest) {
  return formatGuestBirthday({
    day: g.data.day ?? null,
    month: g.data.month ?? null,
    year: g.data.year ?? null,
  });
}
function GuestAvatar({
  guest,
  large = false,
}: {
  guest: Guest;
  large?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 font-medium text-brand",
        large ? "size-14 text-base" : "size-10 text-xs",
      )}
    >
      {guest.photoUrl && failed !== guest.photoUrl ? (
        <img
          src={guest.photoUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(guest.photoUrl ?? null)}
        />
      ) : (
        guest.data.name
          ?.split(/\s+/)
          .slice(0, 2)
          .map((s) => s[0])
          .join("") || "Г"
      )}
    </span>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4 border-b py-3 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">
        {children || "—"}
      </span>
    </div>
  );
}
export function GuestsClient({ initial }: { initial: GuestList }) {
  const [data, setData] = useState(initial),
    [filters, setFilters] = useState(initialFilters),
    [searchOpen, setSearchOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<GuestDetail | null>(null),
    [cardOpen, setCardOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<GuestEditable>({ name: "" }),
    [photoUrl, setPhotoUrl] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false),
    [historyMore, setHistoryMore] = useState(false),
    [tab, setTab] = useState("details"),
    [confirm, setConfirm] = useState<
      "close" | "close-settings" | "archive" | "restore" | null
    >(null),
    [config, setConfig] = useState<GuestConfiguration | null>(null),
    [settingsOpen, setSettingsOpen] = useState(false),
    [rules, setRules] = useState(defaultGuestRules),
    [rulesReason, setRulesReason] = useState("");
  const request = useRef(crypto.randomUUID()),
    listSequence = useRef(0),
    detailSequence = useRef(0),
    file = useRef<HTMLInputElement>(null);
  const params = useSearchParams(),
    router = useRouter();
  const patch = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) =>
        JSON.stringify(value) !==
        JSON.stringify(detail?.data[key as keyof GuestEditable]),
    ),
  );
  const dirty =
    editing &&
    (detail
      ? Object.keys(patch).length > 0
      : !!draft.name || Object.keys(draft).length > 1);
  const refresh = useCallback(
    async (f: GuestFilters) => {
      const seq = ++listSequence.current;
      setLoading(true);
      try {
        const next = await loadGuests(f, initial.venueId);
        if (seq === listSequence.current) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (seq === listSequence.current)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить гостей",
          );
      } finally {
        if (seq === listSequence.current) setLoading(false);
      }
    },
    [initial.venueId],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh(filters);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, refresh]);
  const openGuest = useCallback(
    async (id: string) => {
      const seq = ++detailSequence.current;
      setDetail(null);
      setCardOpen(true);
      setEditing(false);
      setTab("details");
      try {
        const g = await loadGuest(initial.venueId, id);
        if (seq === detailSequence.current) {
          setHistoryMore(g.history.length > 20);
          setDetail({ ...g, history: g.history.slice(0, 20) });
          setDraft({ name: g.data.name ?? "" });
          setPhotoUrl(g.photoUrl ?? null);
        }
      } catch (e) {
        if (seq === detailSequence.current) {
          toast.error(
            e instanceof Error ? e.message : "Не удалось открыть гостя",
          );
          setCardOpen(false);
        }
      }
    },
    [initial.venueId],
  );
  const linked = params.get("guest");
  useEffect(() => {
    if (linked && /^[a-f0-9-]{36}$/i.test(linked)) void openGuest(linked);
  }, [linked, openGuest]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh(filters);
        if (detail && !editing && tab !== "history")
          void loadGuest(initial.venueId, detail.id)
            .then((g) => {
              setHistoryMore(g.history.length > 20);
              setDetail((old) =>
                old?.id === g.id
                  ? { ...g, history: g.history.slice(0, 20) }
                  : old,
              );
            })
            .catch(() => {});
      }
    }, 240000);
    return () => clearInterval(timer);
  }, [refresh, filters, detail, editing, initial.venueId, tab]);
  function close() {
    detailSequence.current++;
    setCardOpen(false);
    setEditing(false);
    setConfirm(null);
    if (linked) router.replace("/crm/guests", { scroll: false });
  }
  function change(p: Partial<GuestFilters>) {
    setFilters((old) => ({ ...old, ...p, page: p.page ?? 0 }));
  }
  async function save() {
    setSaving(true);
    try {
      const result = await saveGuest({
        venue: initial.venueId,
        action: detail ? "update" : "create",
        id: detail?.id ?? null,
        revision: detail?.revision ?? 0,
        request: request.current,
        patch: detail ? patch : draft,
        reason: reason || "Создание карточки гостя",
      });
      request.current = crypto.randomUUID();
      setEditing(false);
      setReason("");
      const next = await loadGuest(initial.venueId, result.id);
      setHistoryMore(next.history.length > 20);
      setDetail({ ...next, history: next.history.slice(0, 20) });
      await refresh(filters);
      toast.success("Карточка сохранена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }
  async function archive() {
    if (
      !detail ||
      !confirm ||
      confirm === "close" ||
      confirm === "close-settings"
    )
      return;
    setSaving(true);
    try {
      await saveGuest({
        venue: initial.venueId,
        action: confirm,
        id: detail.id,
        revision: detail.revision,
        request: request.current,
        patch: {},
        reason,
      });
      request.current = crypto.randomUUID();
      close();
      setReason("");
      await refresh(filters);
      toast.success(
        confirm === "archive" ? "Гость в архиве" : "Гость восстановлен",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }
  async function photoSelected(f: File | undefined) {
    if (!f) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set("photo", f);
      const result = await uploadGuestPhoto(initial.venueId, form);
      setDraft((old) => ({ ...old, photoPath: result.path }));
      setPhotoUrl(result.url);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить фотографию",
      );
    } finally {
      setSaving(false);
    }
  }
  async function settings() {
    setSettingsOpen(true);
    try {
      const c = await guestConfiguration(initial.venueId);
      setConfig(c);
      setRules(c.versions[0]?.config ?? defaultGuestRules);
      setRulesReason("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить настройки",
      );
      setSettingsOpen(false);
    }
  }
  useEffect(() => {
    if (
      !settingsOpen ||
      !config ||
      !["pending", "running"].includes(config.job?.state ?? "")
    )
      return;
    const timer = setInterval(() => {
      void guestConfiguration(initial.venueId)
        .then((next) => {
          setConfig((old) =>
            old
              ? {
                  ...old,
                  job: next.job,
                  checkedAt: next.checkedAt,
                  rows: next.rows,
                  groups: next.groups,
                }
              : old,
          );
          if (next.job?.state === "done") void refresh(filters);
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [settingsOpen, config, initial.venueId, refresh, filters]);
  const discarding = confirm?.startsWith("close") ?? false;
  const show = (v: unknown) =>
    Array.isArray(v)
      ? v.join(", ")
      : typeof v === "boolean"
        ? v
          ? "Да"
          : "Нет"
        : v == null
          ? "—"
          : String(v);
  return (
    <PageFrame className="space-y-6">
      <TablePageHeader
        title="Гости"
        subtitle={`${filters.search || filters.group || filters.birthday ? "Найдено: " : ""}${data.total.toLocaleString("ru-RU")}${filters.search || filters.group || filters.birthday ? "" : filters.archived ? " в архиве" : " в базе"}`}
        actions={
          <>
            {data.canConfigure && (
              <Button
                variant="outline"
                size="icon"
                aria-label="Настройки гостей"
                onClick={() => void settings()}
              >
                <Settings2 className="size-4" />
              </Button>
            )}
            {data.canManage && (
              <Button
                onClick={() => {
                  detailSequence.current++;
                  setDetail(null);
                  setDraft({ name: "" });
                  setPhotoUrl(null);
                  setReason("");
                  request.current = crypto.randomUUID();
                  setEditing(true);
                  setTab("details");
                  setCardOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                Добавить гостя
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <TableControls
          filters={{
            active: !!filters.group || !!filters.birthday || filters.archived,
            content: (
              <div className="flex flex-col gap-3">
                <Select
                  value={filters.group || "all"}
                  onValueChange={(v) => change({ group: v === "all" ? "" : v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Все группы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все группы</SelectItem>
                    {data.groups.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filters.birthday || "all"}
                  onValueChange={(v) =>
                    change({
                      birthday:
                        v === "all" ? "" : (v as GuestFilters["birthday"]),
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Дни рождения</SelectItem>
                    <SelectItem value="today">Сегодня</SelectItem>
                    <SelectItem value="upcoming">
                      В ближайшие 14 дней
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={filters.archived ? "archive" : "active"}
                  onValueChange={(v) => change({ archived: v === "archive" })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активные</SelectItem>
                    <SelectItem value="archive">Архив</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ),
          }}
          search={{
            value: filters.search,
            onChange: (search) => change({ search }),
            open: searchOpen,
            onOpenChange: setSearchOpen,
            placeholder: data.canDetails ? "Имя или контакт" : "Имя гостя",
          }}
          sort={{
            active: filters.sort !== "name" || filters.desc,
            content: (
              <div className="space-y-3">
                <Label>Сортировка</Label>
                <Select
                  value={filters.sort}
                  onValueChange={(v) =>
                    change({ sort: v as GuestFilters["sort"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">По имени</SelectItem>
                    <SelectItem value="birthday">По дню рождения</SelectItem>
                    <SelectItem value="group">По группе</SelectItem>
                    <SelectItem value="updated">По обновлению</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={() => change({ desc: !filters.desc })}
                >
                  <ArrowUpDown className="mr-2 size-4" />
                  {filters.desc ? "По убыванию" : "По возрастанию"}
                </Button>
              </div>
            ),
          }}
        />
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          {error}
          <Button variant="ghost" onClick={() => void refresh(filters)}>
            Повторить
          </Button>
        </div>
      )}
      <div
        aria-busy={loading}
        className={cn("rounded-lg border", loading && "opacity-60")}
      >
        <table className="hidden w-full table-fixed text-sm sm:table">
          <colgroup>
            <col className="w-[52%] sm:w-[45%]" />
            <col className="hidden sm:table-column sm:w-[25%]" />
            <col className="w-[38%] sm:w-[25%]" />
            <col className="w-[10%] sm:w-[5%]" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-muted [&_th]:bg-muted">
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="rounded-tl-lg px-4 py-3 font-medium">Гость</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">
                Группа · скидка
              </th>
              <th className="px-4 py-3 font-medium">День рождения</th>
              <th className="rounded-tr-lg">
                <span className="sr-only">Открыть</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((g) => (
              <tr
                key={g.id}
                className="group cursor-pointer border-b last:border-0 hover:bg-muted/40"
                onClick={() => void openGuest(g.id)}
              >
                <td className="px-4 py-4">
                  <button
                    className="flex w-full min-w-0 items-center gap-3 text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openGuest(g.id);
                    }}
                  >
                    <GuestAvatar guest={g} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {g.data.name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {g.data.sourceMissing
                          ? "Нет в Quick Resto"
                          : g.data.regular
                            ? "Постоянный гость"
                            : g.qrId
                              ? "Quick Resto"
                              : "Карточка заведения"}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground sm:hidden">
                        {g.data.groupTitle ?? "Без группы"}
                        {g.data.discountPercent != null
                          ? ` · ${g.data.discountPercent}%`
                          : ""}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="hidden truncate px-4 py-4 sm:table-cell">
                  {g.data.groupTitle ?? "—"}
                  {g.data.discountPercent != null && (
                    <span className="ml-2 rounded-full bg-brand/10 px-2 py-1 text-xs text-brand">
                      {g.data.discountPercent}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-4 tabular-nums">{birthday(g)}</td>
                <td>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="divide-y sm:hidden">
          {data.rows.map((g) => (
            <button
              key={g.id}
              onClick={() => void openGuest(g.id)}
              className="block w-full p-4 text-left hover:bg-muted/40"
            >
              <span className="flex items-center gap-3">
                <GuestAvatar guest={g} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">
                    {g.data.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {g.data.sourceMissing
                      ? "Нет в Quick Resto"
                      : g.data.regular
                        ? "Постоянный гость"
                        : g.qrId
                          ? "Quick Resto"
                          : "Карточка заведения"}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                <span>
                  {g.data.groupTitle ?? "Без группы"}
                  {g.data.discountPercent != null
                    ? ` · скидка ${g.data.discountPercent}%`
                    : ""}
                </span>
                {g.data.day && (
                  <span className="flex items-center gap-1">
                    <Cake className="size-3" />
                    {birthday(g)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        {!data.rows.length && (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            {filters.search || filters.group || filters.birthday
              ? "Гости не найдены. Попробуйте изменить фильтры."
              : filters.archived
                ? "В архиве пока нет гостей."
                : "Пока нет гостей. Добавьте карточку или обновите базу в настройках."}
          </div>
        )}
      </div>
      <TablePagination
        pageIndex={filters.page}
        pageSize={filters.size}
        total={data.total}
        onPageChange={(page) => change({ page })}
        onPageSizeChange={(size) => change({ size })}
      />
      <EditDrawer
        open={cardOpen}
        onOpenChange={(o) => {
          if (!o) {
            if (saving) return;
            if (dirty) setConfirm("close");
            else close();
          }
        }}
        title={
          editing
            ? detail
              ? "Редактировать гостя"
              : "Новый гость"
            : (detail?.data.name ?? "Гость")
        }
        description={detail?.archived ? "В архиве" : undefined}
        footer={
          editing ? (
            <>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  if (dirty) setConfirm("close");
                  else close();
                }}
              >
                Отмена
              </Button>
              <Button
                disabled={
                  saving ||
                  !draft.name.trim() ||
                  (!detail ? false : !dirty) ||
                  (!!detail && !reason.trim())
                }
                onClick={() => void save()}
              >
                {saving ? "Сохраняем…" : "Сохранить"}
              </Button>
            </>
          ) : detail?.canManage ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setReason("");
                  setConfirm(detail.archived ? "restore" : "archive");
                }}
              >
                {detail.archived ? (
                  <RotateCcw className="mr-2 size-4" />
                ) : (
                  <Archive className="mr-2 size-4" />
                )}
                {detail.archived ? "Восстановить" : "В архив"}
              </Button>
              {!detail.archived && (
                <Button
                  onClick={() => {
                    const editable = Object.fromEntries(
                      Object.entries(detail.data).filter(
                        ([k]) =>
                          k in guestFields &&
                          ![
                            "groupId",
                            "groupTitle",
                            "discountPercent",
                            "sourceMissing",
                            "issues",
                          ].includes(k),
                      ),
                    );
                    setDraft({ name: "", ...editable } as GuestEditable);
                    setPhotoUrl(detail.photoUrl ?? null);
                    request.current = crypto.randomUUID();
                    setReason("");
                    setEditing(true);
                  }}
                >
                  Редактировать
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {editing ? (
          <fieldset disabled={saving} className="space-y-5">
            <div className="flex items-center gap-4">
              <GuestAvatar
                large
                guest={{
                  ...(detail ?? {
                    id: "",
                    revision: 0,
                    qrId: null,
                    legacyId: null,
                    archived: false,
                    createdAt: "",
                    updatedAt: "",
                  }),
                  data: draft,
                  photoUrl,
                }}
              />
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => file.current?.click()}
              >
                <Camera className="mr-2 size-4" />
                {draft.photoPath ? "Изменить фото" : "Прикрепить фото"}
              </Button>
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void photoSelected(e.target.files?.[0])}
              />
            </div>
            <Field label="Имя гостя">
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                maxLength={500}
              />
            </Field>
            <Field label="Телефон и другие контакты">
              <Textarea
                value={draft.contacts ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, contacts: e.target.value || null }))
                }
                maxLength={4000}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              {(["day", "month", "year"] as const).map((key, i) => (
                <Field key={key} label={["День", "Месяц", "Год"][i]}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={key === "year" ? 1900 : 1}
                    max={key === "day" ? 31 : key === "month" ? 12 : 2100}
                    placeholder="—"
                    value={draft[key] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [key]: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <p className="-mt-3 text-xs text-muted-foreground">
              Год рождения можно не указывать.
            </p>
            {detail?.qrId && (
              <div className="rounded-lg bg-muted/50 p-4 text-sm">
                <span className="text-muted-foreground">
                  Условия Quick Resto
                </span>
                <div className="mt-1 font-medium">
                  {detail.data.groupTitle ?? "Без группы"}
                  {detail.data.discountPercent != null
                    ? ` · скидка ${detail.data.discountPercent}%`
                    : ""}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label htmlFor="guest-regular">Постоянный гость</Label>
              <Switch
                id="guest-regular"
                checked={draft.regular === true}
                onCheckedChange={(regular) =>
                  setDraft((d) => ({ ...d, regular }))
                }
              />
            </div>
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Предпочтения и подробности
              </summary>
              <div className="mt-4 space-y-4">
                {(
                  [
                    "instagram",
                    "gender",
                    "sociability",
                    "work",
                    "alcohol",
                    "mobility",
                  ] as const
                ).map((key) => (
                  <Field key={key} label={guestFields[key]}>
                    <Input
                      value={draft[key] ?? ""}
                      maxLength={4000}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [key]: e.target.value || null,
                        }))
                      }
                    />
                  </Field>
                ))}
                {(
                  ["personality", "hobbies", "channels", "benefits"] as const
                ).map((key) => (
                  <Field key={key} label={guestFields[key]}>
                    <ListInput
                      value={draft[key]}
                      onChange={(values) =>
                        setDraft((d) => ({ ...d, [key]: values }))
                      }
                    />
                  </Field>
                ))}
              </div>
            </details>
            <Field label="Заметки">
              <Textarea
                rows={4}
                maxLength={4000}
                value={draft.note ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, note: e.target.value || null }))
                }
              />
            </Field>
            {detail && (
              <Field label="Основание изменения">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </Field>
            )}
          </fieldset>
        ) : detail ? (
          <>
            <div className="flex items-center gap-4">
              <GuestAvatar guest={detail} large />
              <div className="min-w-0">
                <p className="truncate font-medium">{detail.data.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.data.groupTitle ?? "Без группы"}
                  {detail.data.discountPercent != null
                    ? ` · скидка ${detail.data.discountPercent}%`
                    : ""}
                </p>
              </div>
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details">Детали</TabsTrigger>
                <TabsTrigger value="history">История</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="mt-5 text-sm">
                <Value label="День рождения">{birthday(detail)}</Value>
                <Value label="Постоянный гость">
                  {detail.data.regular == null
                    ? "Не указан"
                    : show(detail.data.regular)}
                </Value>
                {detail.canDetails &&
                  Object.entries(guestFields)
                    .filter(
                      ([k]) =>
                        ![
                          "name",
                          "day",
                          "month",
                          "year",
                          "groupTitle",
                          "groupId",
                          "discountPercent",
                          "regular",
                          "photoPath",
                          "issues",
                          "sourceMissing",
                        ].includes(k) &&
                        detail.data[k as keyof GuestEditable] != null,
                    )
                    .map(([k, l]) => (
                      <Value key={k} label={l}>
                        {show(detail.data[k as keyof GuestEditable])}
                      </Value>
                    ))}
                {!detail.canDetails && (
                  <p className="mt-4 text-muted-foreground">
                    Контакты и предпочтения доступны с правом просмотра
                    подробностей гостей.
                  </p>
                )}
                {detail.data.issues?.map((i) => (
                  <p key={i} className="mt-4 text-muted-foreground">
                    {i}
                  </p>
                ))}
                {detail.data.sourceMissing && (
                  <p className="mt-4 text-muted-foreground">
                    Гостя нет в текущем полном списке Quick Resto. Карточка
                    сохранена.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="history" className="mt-5">
                <ol className="space-y-5">
                  {detail.history.map((h) => (
                    <li
                      key={h.id}
                      className="border-b pb-5 text-sm last:border-0"
                    >
                      <p className="font-medium">
                        {guestHistoryActions[h.action] ?? "Карточка обновлена"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {h.actor_name} · {dateTime(h.created_at)}
                      </p>
                      {h.reason && (
                        <p className="mt-2 text-muted-foreground">{h.reason}</p>
                      )}
                      {h.before_data && (
                        <details className="mt-3 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">
                            Изменённые поля
                          </summary>
                          <div className="mt-3 space-y-1">
                            {Object.keys({ ...h.before_data, ...h.after_data })
                              .filter(
                                (k) =>
                                  JSON.stringify(
                                    h.before_data?.[k as keyof GuestEditable],
                                  ) !==
                                  JSON.stringify(
                                    h.after_data?.[k as keyof GuestEditable],
                                  ),
                              )
                              .map((k) => (
                                <p key={k} className="break-words">
                                  <span className="text-muted-foreground">
                                    {guestFields[k] ?? "Сведения"}:{" "}
                                  </span>
                                  {k === "photoPath"
                                    ? "Фотография изменена"
                                    : `${show(h.before_data?.[k as keyof GuestEditable])} → ${show(h.after_data?.[k as keyof GuestEditable])}`}
                                </p>
                              ))}
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
                {historyMore && (
                  <Button
                    variant="outline"
                    className="mt-4 w-full"
                    onClick={async () => {
                      try {
                        const next = await loadGuest(
                          initial.venueId,
                          detail.id,
                          detail.history[detail.history.length - 1].id,
                        );
                        setHistoryMore(next.history.length > 20);
                        setDetail((old) =>
                          old?.id === next.id
                            ? {
                                ...old,
                                history: [
                                  ...old.history,
                                  ...next.history.slice(0, 20),
                                ],
                              }
                            : old,
                        );
                      } catch {
                        toast.error("Не удалось загрузить историю");
                      }
                    }}
                  >
                    Ранее
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="py-12 text-sm text-muted-foreground">
            Загружаем карточку…
          </div>
        )}
      </EditDrawer>
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o && !saving) setConfirm(null);
        }}
      >
        <DialogContent hideClose aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {discarding
                ? "Не сохранять изменения?"
                : confirm === "archive"
                  ? "Переместить гостя в архив?"
                  : "Восстановить гостя?"}
            </DialogTitle>
          </DialogHeader>
          {!discarding && (
            <Field label="Основание">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
              />
            </Field>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setConfirm(null)}
            >
              Вернуться
            </Button>
            <Button
              disabled={saving || (!discarding && !reason.trim())}
              onClick={() =>
                discarding
                  ? confirm === "close-settings"
                    ? (setSettingsOpen(false), setConfirm(null))
                    : close()
                  : void archive()
              }
            >
              {discarding
                ? "Не сохранять"
                : confirm === "archive"
                  ? "В архив"
                  : "Восстановить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EditDrawer
        open={settingsOpen}
        onOpenChange={(o) => {
          if (saving) return;
          if (
            !o &&
            config &&
            JSON.stringify(rules) !==
              JSON.stringify(config.versions[0]?.config ?? defaultGuestRules)
          ) {
            setConfirm("close-settings");
            return;
          }
          setSettingsOpen(o);
        }}
        title="Настройки гостей"
        footer={
          config ? (
            <Button
              disabled={saving || !rulesReason.trim()}
              onClick={async () => {
                setSaving(true);
                try {
                  await saveGuestRules(
                    initial.venueId,
                    config.versions[0]?.version ?? 0,
                    rules,
                    rulesReason,
                  );
                  setConfig(await guestConfiguration(initial.venueId));
                  setRulesReason("");
                  toast.success("Настройки сохранены");
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Не удалось сохранить",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              Сохранить настройки
            </Button>
          ) : undefined
        }
      >
        {config ? (
          <>
            <div className="rounded-lg border p-4 text-sm">
              <p className="font-medium">Quick Resto</p>
              <p className="mt-1 text-muted-foreground">
                {config.checkedAt
                  ? `${config.rows.toLocaleString("ru-RU")} гостей · ${dateTime(config.checkedAt)}`
                  : "База ещё не загружена"}
              </p>
              <p className="mt-2 text-muted-foreground">
                {config.job?.state === "error"
                  ? config.job.error
                  : config.job?.state === "pending" ||
                      config.job?.state === "running"
                    ? `Обновление: ${config.job.phase === "verify" ? "проверка" : "чтение"}, ${config.job.cursor} гостей`
                    : "Группа и скидка обновляются из Quick Resto."}
              </p>
              <Button
                className="mt-3"
                variant="outline"
                disabled={
                  saving ||
                  ["pending", "running"].includes(config.job?.state ?? "")
                }
                onClick={async () => {
                  setSaving(true);
                  try {
                    await readGuests(initial.venueId);
                    setConfig(await guestConfiguration(initial.venueId));
                    toast.success("Обновление запущено");
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Не удалось запустить",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <RefreshCw className="mr-2 size-4" />
                Обновить базу
              </Button>
              <Button
                className="mt-3 ml-2"
                variant="ghost"
                onClick={() =>
                  void guestConfiguration(initial.venueId)
                    .then((next) => {
                      setConfig((old) =>
                        old
                          ? {
                              ...old,
                              job: next.job,
                              checkedAt: next.checkedAt,
                              rows: next.rows,
                              groups: next.groups,
                            }
                          : old,
                      );
                      void refresh(filters);
                    })
                    .catch(() => toast.error("Не удалось проверить обновление"))
                }
              >
                Проверить
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="guest-auto">Обновлять автоматически</Label>
              <Switch
                id="guest-auto"
                checked={rules.autoRead}
                onCheckedChange={(autoRead) =>
                  setRules((r) => ({
                    ...r,
                    autoRead,
                    ...(!autoRead
                      ? {
                          birthdayToday: false,
                          birthdayUpcoming: false,
                          groupTransitions: false,
                        }
                      : {}),
                  }))
                }
              />
            </div>
            <Field label="Интервал обновления, минут">
              <Input
                type="number"
                min={15}
                max={1440}
                value={rules.intervalMinutes}
                onChange={(e) =>
                  setRules((r) => ({
                    ...r,
                    intervalMinutes: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <section className="space-y-4 border-t pt-5">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Cake className="size-4" />
                Дни рождения
              </h3>
              {(["birthdayToday", "birthdayUpcoming"] as const).map((k, i) => (
                <div key={k} className="flex items-center justify-between">
                  <Label htmlFor={k}>
                    {i === 0
                      ? "Напомнить в день рождения"
                      : "Напомнить заранее"}
                  </Label>
                  <Switch
                    id={k}
                    disabled={!rules.autoRead}
                    checked={rules[k]}
                    onCheckedChange={(v) => setRules((r) => ({ ...r, [k]: v }))}
                  />
                </div>
              ))}
              {rules.birthdayUpcoming && (
                <Field label="За сколько дней">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={rules.leadDays}
                    onChange={(e) =>
                      setRules((r) => ({
                        ...r,
                        leadDays: Number(e.target.value),
                      }))
                    }
                  />
                </Field>
              )}
              <TimeField
                label="Время уведомления"
                hour={rules.birthdayHour}
                minute={rules.birthdayMinute}
                onChange={(h, m) =>
                  setRules((r) => ({
                    ...r,
                    birthdayHour: h,
                    birthdayMinute: m,
                  }))
                }
              />
            </section>
            <section className="space-y-4 border-t pt-5">
              <div className="flex items-center justify-between">
                <Label htmlFor="guest-group">Новые гости в группе</Label>
                <Switch
                  id="guest-group"
                  disabled={!rules.autoRead}
                  checked={rules.groupTransitions}
                  onCheckedChange={(groupTransitions) =>
                    setRules((r) => ({ ...r, groupTransitions }))
                  }
                />
              </div>
              <Select
                value={String(rules.groupId)}
                onValueChange={(v) =>
                  setRules((r) => ({ ...r, groupId: Number(v) }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Группа Quick Resto" />
                </SelectTrigger>
                <SelectContent>
                  {config.groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.title} · {g.discountPercent}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TimeField
                label="Время уведомления"
                hour={rules.groupHour}
                minute={rules.groupMinute}
                onChange={(h, m) =>
                  setRules((r) => ({ ...r, groupHour: h, groupMinute: m }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Уведомляем о новых гостях после включения правила. Текущее время
                заведения. Получатели — владелец и пользователи с доступом к
                гостям.
              </p>
            </section>
            <Field label="Основание изменения">
              <Textarea
                value={rulesReason}
                onChange={(e) => setRulesReason(e.target.value)}
                maxLength={1000}
              />
            </Field>
            {config.versions.length > 0 && (
              <details className="border-t pt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  История настроек
                </summary>
                <ol className="mt-4 space-y-4">
                  {config.versions.map((v) => (
                    <li key={v.id} className="text-sm">
                      <p>{v.reason}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {v.actor_name} · {dateTime(v.created_at)} · версия{" "}
                        {v.version}
                      </p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Загружаем настройки…</p>
        )}
      </EditDrawer>
    </PageFrame>
  );
}
function TimeField({
  label,
  hour,
  minute,
  onChange,
}: {
  label: string;
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="time"
        value={`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
        onChange={(e) => {
          const [h, m] = e.target.value.split(":").map(Number);
          if (Number.isInteger(h) && Number.isInteger(m)) onChange(h, m);
        }}
      />
    </Field>
  );
}

function ListInput({
  value,
  onChange,
}: {
  value?: string[];
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState(() => value?.join(", ") ?? "");
  return (
    <Input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
