"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { useTheme } from "next-themes";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarPlus,
  ClipboardList,
  CornerDownLeft,
  FileBadge2,
  Keyboard,
  LayoutDashboard,
  Moon,
  Receipt,
  Search,
  Sun,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyIllustration } from "@/components/ui/empty-state";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { useKbSearch } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
import {
  NAV_SECTIONS,
  navItemVisible,
  navSectionVisible,
} from "@/components/shared/nav-sections";
import { searchPalette } from "@/lib/command-palette/search";
import {
  PALETTE_GROUP_LABEL,
  type PaletteGroup,
  type PaletteHit,
} from "@/lib/command-palette/types";
import { applyTheme } from "@/lib/theme";
import { personInitials } from "@/lib/format/initials";
import { avatarThumbUrl } from "@/lib/people/avatar-thumb";

/** Событие окна: открыть палитру (кнопка поиска в верхней панели). */
export const COMMAND_PALETTE_OPEN_EVENT = "command-palette:open";

export function openCommandPalette() {
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
}

type Entry = {
  id: string;
  title: string;
  /** Подпись справа: раздел меню. */
  hint?: string;
  icon: LucideIcon;
  /** Дополнительные слова для поиска («операция», «платёж»). */
  keywords?: string;
  run: () => void;
};

const GROUP_ICON: Record<PaletteGroup, LucideIcon> = {
  staff: Users,
  candidates: UserRound,
  guests: UserRound,
  acts: ClipboardList,
  transactions: Receipt,
  knowledge: BookOpen,
};

const SEARCH_GROUPS: PaletteGroup[] = [
  "staff",
  "candidates",
  "guests",
  "acts",
  "transactions",
  "knowledge",
];

const DEBOUNCE_MS = 250;

/**
 * Палитра ⌘K (Ctrl+K): переход в любой раздел меню (с учётом прав), поиск
 * людей, гостей, актов, операций и страниц базы знаний, быстрые действия.
 * Монтируется один раз в dashboard-layout внутри `KbSearchProvider`.
 *
 * В базе знаний ⌘K по-прежнему открывает её собственный поиск
 * (`kb-search-dialog.tsx`) — там он привычнее; из палитры к нему ведёт
 * действие «Поиск по базе знаний», а страницы базы подмешиваются в находки.
 */
export function CommandPaletteProvider({
  userPermissions,
  activeRoleCode,
}: {
  userPermissions: string[];
  activeRoleCode: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const onKnowledge = pathname === "/knowledge" || pathname.startsWith("/knowledge/");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "k" && e.code !== "KeyK") return;
      if (onKnowledge) return; // там ⌘K — поиск базы знаний
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
    };
  }, [onKnowledge]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        // Палитра — у верхней трети экрана, как поиск базы знаний.
        className="top-[12vh] w-[calc(100%-24px)] max-w-[640px] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:top-[14vh]"
        aria-describedby={undefined}
        hideClose
        // Фокус — сразу в поле поиска.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector("input")?.focus();
        }}
      >
        <DialogTitle className="sr-only">Поиск и команды</DialogTitle>
        {open && (
          <Palette
            userPermissions={userPermissions}
            activeRoleCode={activeRoleCode}
            onClose={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Palette({
  userPermissions,
  activeRoleCode,
  onClose,
}: {
  userPermissions: string[];
  activeRoleCode: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { open: openKbSearch } = useKbSearch();
  const { resolvedTheme, setTheme } = useTheme();
  const perms = useMemo(() => new Set(userPermissions), [userPermissions]);
  const [query, setQuery] = useState("");
  const { hits, loading } = usePaletteSearch(query);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const pages = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      { id: "page:/dashboard", title: "Главная", icon: LayoutDashboard, keywords: "сегодня дашборд", run: () => go("/dashboard") },
    ];
    for (const section of NAV_SECTIONS) {
      if (!navSectionVisible(section, perms, activeRoleCode)) continue;
      if (section.href) {
        list.push({ id: `page:${section.href}`, title: section.label, icon: section.icon, run: () => go(section.href!) });
        continue;
      }
      for (const item of section.items) {
        if (!navItemVisible(item, perms, activeRoleCode)) continue;
        list.push({
          id: `page:${item.href}`,
          title: item.title,
          hint: section.label,
          icon: item.icon,
          run: () => go(item.href),
        });
      }
    }
    list.push({ id: "page:/notifications", title: "Уведомления", icon: Bell, run: () => go("/notifications") });
    list.push({ id: "page:/profile", title: "Мой профиль", icon: UserRound, keywords: "настройки профиля", run: () => go("/profile") });
    return list;
  }, [perms, activeRoleCode, go]);

  const actions = useMemo<Entry[]>(() => {
    const has = (code: string) => perms.has(code);
    const list: Entry[] = [];
    if (has("schedule.shift_create"))
      list.push({ id: "act:shift", title: "Новая смена", hint: "Расписание", icon: CalendarPlus, keywords: "график смена добавить", run: () => go("/schedule?create=shift") });
    if (has("finance.create_transaction")) {
      list.push({ id: "act:expense", title: "Добавить расход", hint: "Транзакции", icon: ArrowUpRight, keywords: "операция платёж транзакция", run: () => go("/finance/transactions?create=expense") });
      list.push({ id: "act:income", title: "Добавить доход", hint: "Транзакции", icon: ArrowDownLeft, keywords: "операция поступление транзакция", run: () => go("/finance/transactions?create=income") });
    }
    if (has("crm.manage_guests") && has("crm.view_guests"))
      list.push({ id: "act:guest", title: "Добавить гостя", hint: "Гости", icon: UserPlus, keywords: "гость карточка", run: () => go("/crm/guests?create=1") });
    if (has("people.invite_staff"))
      list.push({ id: "act:casual", title: "Добавить сотрудника на подработку", hint: "Сотрудники", icon: UserPlus, keywords: "сотрудник подработка", run: () => go("/people/staff?add=casual") });
    if (has("finance.manage_counterparties"))
      list.push({ id: "act:counterparty", title: "Новый контрагент", hint: "Контрагенты", icon: Users, keywords: "поставщик", run: () => go("/finance/counterparties?create=1") });
    if (has("finance.manage_bank_accounts"))
      list.push({ id: "act:account", title: "Новый счёт или касса", hint: "Счета и кассы", icon: Wallet, keywords: "банк касса", run: () => go("/finance/accounts?create=1") });
    if (has("org.manage_legal_entities"))
      list.push({ id: "act:legal", title: "Новое юридическое лицо", hint: "Юридические лица", icon: FileBadge2, keywords: "юрлицо организация", run: () => go("/org/legal-entities?create=1") });
    if (has("kb.view_pages"))
      list.push({
        id: "act:kb-search",
        title: "Поиск по базе знаний",
        hint: "База знаний",
        icon: BookOpen,
        keywords: "статья страница регламент",
        run: () => {
          onClose();
          // Окно палитры закрывается 160 мс — открываем поиск базы после.
          window.setTimeout(openKbSearch, 180);
        },
      });
    list.push({
      id: "act:hotkeys",
      title: "Горячие клавиши",
      icon: Keyboard,
      keywords: "сочетания клавиатура",
      run: () => {
        onClose();
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("hotkeys:open")), 180);
      },
    });
    const dark = resolvedTheme === "dark";
    list.push({
      id: "act:theme",
      title: dark ? "Светлая тема" : "Тёмная тема",
      icon: dark ? Sun : Moon,
      keywords: "тема оформление цвет",
      run: () => {
        onClose();
        applyTheme(dark ? "light" : "dark", setTheme);
      },
    });
    return list;
  }, [perms, go, onClose, openKbSearch, resolvedTheme, setTheme]);

  const q = normalize(query);
  const matchedActions = q ? actions.filter((e) => matches(e, q)) : actions.slice(0, 5);
  const matchedPages = q ? pages.filter((e) => matches(e, q)) : pages;
  const searching = q.length >= 2;
  const nothing =
    searching && !loading && hits.length === 0 && matchedActions.length === 0 && matchedPages.length === 0;

  // Без встроенного фильтра cmdk не переносит выделение, когда список
  // сменился (пришли находки с сервера): держим его сами — на первой строке.
  const order = [
    ...(q ? matchedPages : []),
    ...matchedActions,
    ...(searching ? SEARCH_GROUPS.flatMap((g) => hits.filter((h) => h.group === g)) : []),
    ...(q ? [] : matchedPages),
  ].map((e) => ("run" in e ? e.id : `${e.group}:${e.id}`));
  const firstValue = order[0] ?? "";
  const listKey = order.join("|");
  const [selected, setSelected] = useState(firstValue);
  useEffect(() => {
    setSelected(firstValue);
    // Сбрасываем на первую строку только при смене состава списка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  return (
    <CommandPrimitive
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      loop
      className="flex max-h-[min(560px,76dvh)] flex-col"
      label="Поиск и команды"
    >
      <div className="flex items-center gap-2 border-b px-4">
        <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <CommandPrimitive.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Раздел, человек, акт, операция или команда"
          className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        />
        <span className="hide-on-coarse-pointer shrink-0">
          <kbd className="hidden rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-xs font-semibold text-muted-foreground sm:inline-flex">
            Esc
          </kbd>
        </span>
      </div>
      <CommandPrimitive.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
        {nothing && (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <EmptyIllustration kind="search" className="h-[72px] w-[90px]" />
            <p className="text-sm font-medium">Ничего не найдено</p>
            <p className="text-[13px] text-muted-foreground">
              Попробуйте имя, номер акта, сумму или название раздела
            </p>
          </div>
        )}

        {q && matchedPages.length > 0 && (
          <CommandPrimitive.Group heading={q ? "Разделы" : "Перейти"}>
            {matchedPages.map((e) => (
              <EntryItem key={e.id} entry={e} />
            ))}
          </CommandPrimitive.Group>
        )}
        {matchedActions.length > 0 && (
          <CommandPrimitive.Group heading="Действия">
            {matchedActions.map((e) => (
              <EntryItem key={e.id} entry={e} />
            ))}
          </CommandPrimitive.Group>
        )}

        {searching &&
          SEARCH_GROUPS.map((group) => {
            const items = hits.filter((h) => h.group === group);
            if (!items.length) return null;
            return (
              <CommandPrimitive.Group key={group} heading={PALETTE_GROUP_LABEL[group]}>
                {items.map((hit) => (
                  <HitItem key={`${group}:${hit.id}`} hit={hit} onSelect={() => go(hit.href)} />
                ))}
              </CommandPrimitive.Group>
            );
          })}

        {searching && loading && <SearchSkeleton />}

        {!q && matchedPages.length > 0 && (
          <CommandPrimitive.Group heading={q ? "Разделы" : "Перейти"}>
            {matchedPages.map((e) => (
              <EntryItem key={e.id} entry={e} />
            ))}
          </CommandPrimitive.Group>
        )}
      </CommandPrimitive.List>
      <div className="hide-on-coarse-pointer items-center gap-4 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          выбрать
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>
            <CornerDownLeft className="size-3" />
          </Kbd>
          открыть
        </span>
      </div>
    </CommandPrimitive>
  );
}

// ── Поиск на сервере: дебаунс + отбрасывание устаревших ответов ──

function usePaletteSearch(query: string) {
  const [hits, setHits] = useState<PaletteHit[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const cache = useRef(new Map<string, PaletteHit[]>());

  useEffect(() => {
    const term = query.trim();
    const id = ++seq.current;
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const cached = cache.current.get(term.toLocaleLowerCase("ru"));
    if (cached) {
      setHits(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const { hits: next } = await searchPalette(term);
        if (seq.current !== id) return;
        cache.current.set(term.toLocaleLowerCase("ru"), next);
        setHits(next);
      } catch {
        if (seq.current === id) setHits([]);
      } finally {
        if (seq.current === id) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  return { hits, loading };
}

// ── Строки ──────────────────────────────────────────────────────

const itemClass =
  "group flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors duration-200 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

function EntryItem({ entry }: { entry: Entry }) {
  const Icon = entry.icon;
  return (
    <CommandPrimitive.Item value={entry.id} onSelect={entry.run} className={itemClass}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
      {entry.hint && (
        <span className="shrink-0 truncate text-xs text-muted-foreground">{entry.hint}</span>
      )}
    </CommandPrimitive.Item>
  );
}

function HitItem({ hit, onSelect }: { hit: PaletteHit; onSelect: () => void }) {
  const Icon = GROUP_ICON[hit.group];
  let lead: ReactNode;
  if (hit.person) lead = <HitAvatar name={hit.title} src={hit.avatarUrl ?? null} />;
  else if (hit.group === "knowledge")
    lead = (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
        <KbPageIcon icon={hit.kbIcon ?? null} color={hit.kbIconColor ?? null} size={16} />
      </span>
    );
  else
    lead = (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
        <Icon className="size-4" />
      </span>
    );
  return (
    <CommandPrimitive.Item value={`${hit.group}:${hit.id}`} onSelect={onSelect} className={itemClass}>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{hit.title}</span>
        {hit.subtitle && (
          <span className="truncate text-xs text-muted-foreground">{hit.subtitle}</span>
        )}
      </span>
    </CommandPrimitive.Item>
  );
}

function HitAvatar({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = src ? (avatarThumbUrl(src) ?? src) : null;
  if (url && !failed)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="size-8 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {personInitials(name)}
    </span>
  );
}

function SearchSkeleton() {
  return (
    <div role="status" aria-label="Ищем" className="space-y-1 px-2.5 py-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5" style={{ width: `${56 - i * 12}%` }} />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[20px] items-center justify-center rounded-sm border border-border bg-muted px-1 py-px font-mono text-xs font-semibold">
      {children}
    </kbd>
  );
}

function normalize(s: string) {
  return s.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
}

/** Каждое слово запроса — начало какого-то слова в названии, разделе или
 *  ключевых словах: «нов см» находит «Новая смена», а «ан» не находит всё
 *  подряд по середине слов. */
function matches(entry: Entry, q: string) {
  const words = normalize(`${entry.title} ${entry.hint ?? ""} ${entry.keywords ?? ""}`).split(/[\s,.«»()-]+/);
  return q.split(/\s+/).every((part) => words.some((word) => word.startsWith(part)));
}
