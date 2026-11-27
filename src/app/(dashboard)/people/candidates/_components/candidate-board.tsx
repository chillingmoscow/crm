"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { PersonAvatar } from "@/components/people/person-avatar";
import { cn } from "@/lib/utils";
import { useExitValue } from "@/hooks/use-exit-value";
import { unwrapAction } from "@/lib/actions/result";
import { candidateError } from "@/lib/candidates/errors";
import { overdueHint, stageAge } from "@/lib/candidates/stage-age";
import { countRu } from "@/lib/format/plural";
import {
  STATUSES,
  STATUS_TONES,
  type Candidate,
  type CandidateDetail,
  type CandidatePermissions,
  type CandidatePhotos,
  type CandidateStatus,
  type HiringOptions,
  type ListFilters,
} from "@/lib/candidates/types";
import { getCandidate, listCandidateBoard } from "../actions";
import { HireDrawer } from "./hire-drawer";
import {
  useCandidateStatusChange,
  type CandidateStatusUpdate,
} from "./candidate-status-change";

/** Колонки доски — этапы по порядку воронки. */
const COLUMNS: CandidateStatus[] = ["new", "review", "interview", "trial", "hired", "rejected"];
/** Этапы в работе: дольше всех ждущие — сверху. У «Не подходит» — последние. */
const ACTIVE: CandidateStatus[] = ["new", "review", "interview", "trial"];

type BoardCandidate = Candidate & Partial<CandidatePhotos>;
type Column = { rows: BoardCandidate[]; total: number };
type Columns = Partial<Record<CandidateStatus, Column>>;

const byStageAsc = (a: Candidate, b: Candidate) =>
  a.stage_changed_at.localeCompare(b.stage_changed_at);
const byStageDesc = (a: Candidate, b: Candidate) => byStageAsc(b, a);

/**
 * Доска кандидатов по этапам — второй вид списка рядом с таблицей. Карточку
 * переносят между колонками мышью, пальцем (долгое нажатие) или с
 * клавиатуры (пробел — взять, стрелки влево и вправо — соседняя колонка,
 * пробел — положить; Enter на имени открывает анкету).
 * Перенос меняет этап тем же действием, что меню статуса в таблице
 * (`useCandidateStatusChange`): права и журнал — те же. «Собеседование» и
 * «Стажировка» открывают запись на встречу, «Принят на работу» — оформление.
 * Куда положить нельзя, видно ещё во время переноса (DS → «Перетаскивание»).
 */
export function CandidateBoard({
  filters,
  options,
  permissions,
  reloadKey,
  onStatusSaved,
  onListChanged,
  onTotal,
}: {
  /** Поиск и условия списка — те же, что у таблицы; сортировка своя. */
  filters: Omit<ListFilters, "sort">;
  options: HiringOptions;
  permissions: CandidatePermissions;
  /** Меняется, когда список нужно перечитать (новые анкеты, удаление). */
  reloadKey: number;
  onStatusSaved: (saved: CandidateStatusUpdate) => void;
  /** Список изменился не сменой этапа (найм): перечитать и таблицу, и доску. */
  onListChanged: () => void;
  /** Сколько анкет на доске — для счётчика в шапке страницы. */
  onTotal: (total: number) => void;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState<Columns | null>(null);
  const [reserved, setReserved] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const chosen = (filters.status ?? []) as CandidateStatus[];
  const visible = chosen.length ? COLUMNS.filter((s) => chosen.includes(s)) : COLUMNS;
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setError("");
    // Принятые уходят в «Сотрудников» и в списке анкет их нет: колонка
    // «Принят на работу» — только место, куда переносят анкету для оформления.
    const stages = visible.filter((s) => s !== "hired");
    const load = stages.length
      ? listCandidateBoard({
          search: filters.search,
          position: filters.position,
          from: filters.from,
          to: filters.to,
          stages,
        }).then(unwrapAction)
      : Promise.resolve({ columns: {}, reserved: [] });
    load
      .then((board) => {
        if (cancelled) return;
        setColumns(board.columns as Columns);
        setReserved(new Set(board.reserved));
      })
      .catch((e) => {
        if (!cancelled) setError(candidateError(e, "Не удалось загрузить кандидатов."));
      });
    return () => {
      cancelled = true;
    };
    // filterKey сериализует фильтры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reload, reloadKey]);

  useEffect(() => {
    if (columns)
      onTotal(Object.values(columns).reduce((sum, c) => sum + (c?.total ?? 0), 0));
  }, [columns, onTotal]);

  // Фото — отдельным запросом, как в таблице: без них остаются инициалы.
  // Догружаем только тех, кого ещё не спрашивали: перенос карточки фото
  // заново не запрашивает.
  const [photos, setPhotos] = useState<Record<string, CandidatePhotos>>({});
  const asked = useRef(new Set<string>());
  const idsKey = useMemo(
    () =>
      columns
        ? Object.values(columns)
            .flatMap((c) => c?.rows.map((r) => r.id) ?? [])
            .sort()
            .join(",")
        : "",
    [columns],
  );
  useEffect(() => {
    const missing = idsKey ? idsKey.split(",").filter((id) => !asked.current.has(id)) : [];
    if (!missing.length) return;
    for (const id of missing) asked.current.add(id);
    let alive = true;
    for (let i = 0; i < missing.length; i += 100) {
      const part = missing.slice(i, i + 100);
      void fetch(`/api/people/candidate-photos?ids=${part.join(",")}`)
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, CandidatePhotos>>) : {}))
        .then((found) => {
          if (alive) setPhotos((current) => ({ ...current, ...found }));
        })
        .catch(() => {
          for (const id of part) asked.current.delete(id);
        });
    }
    return () => {
      alive = false;
    };
  }, [idsKey]);

  /** Смена этапа без перечитывания: своя или пришедшая от коллеги. */
  const apply = useCallback((update: CandidateStatusUpdate) => {
    setColumns((current) => {
      if (!current) return current;
      const row = Object.values(current)
        .flatMap((c) => c?.rows ?? [])
        .find((r) => r.id === update.id);
      if (!row || row.revision >= update.revision) return current;
      const moved: BoardCandidate = {
        ...row,
        ...update,
        stage_changed_at:
          update.status !== row.status ? new Date().toISOString() : row.stage_changed_at,
      };
      const next: Columns = { ...current };
      const source = current[row.status];
      if (source)
        next[row.status] = {
          rows: source.rows.filter((r) => r.id !== row.id),
          total: Math.max(0, source.total - 1),
        };
      // Принятый уходит из списка анкет; этап, которого нет на доске
      // (отфильтрован), карточку не получает.
      const target = next[moved.status];
      if (moved.status !== "hired" && target) {
        const rows = [...target.rows.filter((r) => r.id !== row.id), moved].sort(
          ACTIVE.includes(moved.status) ? byStageAsc : byStageDesc,
        );
        next[moved.status] = { rows, total: target.total + 1 };
      }
      return next;
    });
  }, []);
  // Коллега перенёс анкету — у нас сразу новая ревизия и место на доске,
  // иначе следующий перенос упрётся в конфликт.
  useEffect(() => {
    const updated = (event: Event) => apply((event as CustomEvent<CandidateStatusUpdate>).detail);
    window.addEventListener("candidates:row-updated", updated);
    return () => window.removeEventListener("candidates:row-updated", updated);
  }, [apply]);

  const saved = useCallback(
    (update: CandidateStatusUpdate) => {
      apply(update);
      onStatusSaved(update);
    },
    [apply, onStatusSaved],
  );
  const { change, pending, panel } = useCandidateStatusChange({
    options,
    onSaved: saved,
    onRefresh: refresh,
  });

  // Оформление найма: сначала читаем анкету целиком, потом открываем панель.
  const [hiring, setHiring] = useState<CandidateDetail | null>(null);
  const [hireOpen, setHireOpen] = useState(false);
  const shownHiring = useExitValue(hiring);
  const [hireLoading, setHireLoading] = useState<string | null>(null);
  const startHire = async (candidate: Candidate) => {
    setHireLoading(candidate.id);
    try {
      setHiring(unwrapAction(await getCandidate(candidate.id)));
      setHireOpen(true);
    } catch (e) {
      toast.error(candidateError(e, "Не удалось открыть оформление."));
    } finally {
      setHireLoading(null);
    }
  };

  const canHireSomewhere = permissions.hire && options.venues.some((v) => v.can_hire);
  /** Почему карточку нельзя положить в колонку; null — можно. */
  const refusal = (candidate: Candidate, target: CandidateStatus): string | null => {
    if (target === candidate.status) return null;
    if (target !== "hired") return null;
    if (!canHireSomewhere) return "Нет права принимать на работу";
    if (candidate.hired_user_id) return "Уже принят";
    // Как в анкете: принять можно со стажировки или продолжить начатое оформление.
    if (candidate.status !== "trial" && !reserved.has(candidate.id)) return "Сначала стажировка";
    return null;
  };

  const reducedMotion = useReducedMotion();
  const [dragging, setDragging] = useState<BoardCandidate | null>(null);
  const [over, setOver] = useState<CandidateStatus | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // На телефоне — долгое нажатие, чтобы доска прокручивалась пальцем.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    // Enter оставляем ссылке на анкету: взять и положить — пробелом,
    // стрелки ставят карточку в соседнюю колонку.
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
      coordinateGetter: toNextColumn,
    }),
  );
  const findRow = (id: string) =>
    columns
      ? Object.values(columns)
          .flatMap((c) => c?.rows ?? [])
          .find((r) => r.id === id) ?? null
      : null;
  const onDragStart = (event: DragStartEvent) => setDragging(findRow(String(event.active.id)));
  const onDragOver = (event: DragOverEvent) =>
    setOver((event.over?.id as CandidateStatus | undefined) ?? null);
  // После переноса с клавиатуры карточка рисуется в другой колонке заново —
  // фокус возвращаем на её имя, чтобы не потерять место на странице.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    const link = document.querySelector<HTMLElement>(`[data-candidate-link="${id}"]`);
    if (link && document.activeElement !== link) {
      link.focus();
      refocus.current = null;
    }
  }, [columns]);
  const onDragEnd = (event: DragEndEvent) => {
    const row = findRow(String(event.active.id));
    const target = event.over?.id as CandidateStatus | undefined;
    setDragging(null);
    setOver(null);
    if (!row || !target || target === row.status) return;
    // Встреча и оформление открывают свою панель — фокус уходит в неё.
    if (event.activatorEvent instanceof KeyboardEvent && !["interview", "trial", "hired"].includes(target))
      refocus.current = row.id;
    const reason = refusal(row, target);
    if (reason) {
      toast.error(reason);
      return;
    }
    if (target === "hired") void startHire(row);
    else void change(row, target);
  };
  const statusName = (id: unknown) => STATUSES[id as CandidateStatus] ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Анкета ${findRow(String(active.id))?.full_name ?? ""} взята.`,
    onDragOver: ({ over }) => (over ? `Над колонкой «${statusName(over.id)}».` : "Вне колонок."),
    onDragEnd: ({ over }) =>
      over ? `Анкета перенесена в «${statusName(over.id)}».` : "Перенос отменён.",
    onDragCancel: () => "Перенос отменён.",
  };

  if (error)
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Повторить загрузку
        </Button>
      </div>
    );

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(null);
          setOver(null);
        }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Enter — открыть анкету. Чтобы перенести её на другой этап, нажмите пробел, выберите колонку стрелками влево и вправо и нажмите пробел ещё раз. Escape — отмена.",
          },
        }}
      >
        <div
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:snap-none sm:scroll-px-0 sm:px-0"
          aria-label="Доска кандидатов по этапам"
          aria-busy={!columns}
        >
          {visible.map((status) => {
            const column = columns?.[status];
            const rows = column?.rows ?? [];
            const reason = dragging ? refusal(dragging, status) : null;
            return (
              <BoardColumn
                key={status}
                status={status}
                count={column ? column.total : null}
                refusal={over === status ? reason : null}
                highlight={over === status && !!dragging && dragging.status !== status && !reason}
              >
                {status === "hired" ? (
                  <p className="px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
                    {canHireSomewhere
                      ? "Перенесите сюда анкету со стажировки — откроется оформление"
                      : "Принимать на работу может тот, у кого есть право на найм"}
                  </p>
                ) : !column ? (
                  [0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] rounded-lg" />)
                ) : rows.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">Анкет нет</p>
                ) : (
                  rows.map((row, i) => (
                    <BoardCard
                      key={row.id}
                      candidate={{ ...row, ...photos[row.id] }}
                      index={i}
                      busy={pending.has(row.id) || hireLoading === row.id}
                      onOpen={() => router.push(`/people/candidates/${row.id}`)}
                    />
                  ))
                )}
                {column && column.total > rows.length && (
                  <p className="px-2 pt-1 text-center text-xs text-muted-foreground">
                    {status === "rejected"
                      ? `Последние ${rows.length} из ${column.total}, остальные — в таблице`
                      : `Показаны ${rows.length} из ${column.total}, остальные — в таблице`}
                  </p>
                )}
              </BoardColumn>
            );
          })}
        </div>
        {/* Анимация возврата идёт через WAAPI и не слушает CSS reduced-motion. */}
        <DragOverlay
          dropAnimation={
            reducedMotion ? null : { duration: 240, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
          }
        >
          {dragging ? (
            <CardBody candidate={{ ...dragging, ...photos[dragging.id] }} lifted />
          ) : null}
        </DragOverlay>
      </DndContext>
      {panel}
      {shownHiring ? (
        <HireDrawer
          key={shownHiring.candidate.id}
          open={hireOpen}
          detail={shownHiring}
          options={options}
          onClose={() => {
            setHireOpen(false);
            setHiring(null);
          }}
          onSaved={() => {
            // Тост «Кандидат принят на работу» и конфетти — в самой панели.
            // Принятый уходит и из таблицы: перечитываем оба вида.
            onListChanged();
            window.dispatchEvent(new Event("candidates:changed"));
          }}
        />
      ) : null}
    </>
  );
}

function BoardColumn({
  status,
  count,
  refusal,
  highlight,
  children,
}: {
  status: CandidateStatus;
  count: number | null;
  refusal: string | null;
  highlight: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUSES[status]}${count !== null ? `: ${countRu(count, "анкета", "анкеты", "анкет")}` : ""}`}
      className={cn(
        "relative flex w-[85vw] max-w-[296px] shrink-0 snap-start flex-col gap-2 rounded-[14px] border bg-muted/40 p-2 transition-colors duration-200 sm:w-[272px]",
        highlight && "border-brand/60 bg-brand/5",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-1 pb-1 pt-0.5">
        <StatusBadge tone={STATUS_TONES[status]}>{STATUSES[status]}</StatusBadge>
        {count !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        )}
      </header>
      <div className="flex min-h-[120px] flex-col gap-2">{children}</div>
      {refusal && (
        <div
          aria-hidden
          // Текст — у верха колонки, рядом с курсором, а не посреди высокой колонки.
          className="pointer-events-none absolute inset-1.5 z-[1] flex items-start justify-center rounded-[10px] border border-dashed border-destructive/60 bg-background/85 px-3 pt-14 text-center text-xs font-medium leading-tight text-destructive"
        >
          {refusal}
        </div>
      )}
    </section>
  );
}

function BoardCard({
  candidate,
  index,
  busy,
  onOpen,
}: {
  candidate: BoardCandidate;
  index: number;
  busy: boolean;
  onOpen: () => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: candidate.id,
    disabled: busy,
  });
  return (
    <div
      ref={setNodeRef}
      // Мышью и пальцем карточку берут за любое место; с клавиатуры —
      // за имя-ссылку: одна остановка Tab, Enter открывает анкету.
      {...listeners}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        onOpen();
      }}
      className={cn(
        "cursor-grab rounded-lg transition-opacity duration-200 active:cursor-grabbing [&:has(a:focus-visible)]:ring-2 [&:has(a:focus-visible)]:ring-brand",
        isDragging && "opacity-40",
        busy && "pointer-events-none opacity-60",
      )}
      style={{ touchAction: "manipulation" }}
    >
      {/* Появление — на внутреннем слое: анимация с fill both перекрыла бы
          прозрачность переносимой карточки. */}
      <div className="table-row-in" style={{ animationDelay: `${Math.min(index, 15) * 40}ms` }}>
        <CardBody
          candidate={candidate}
          nameRef={setActivatorNodeRef}
          nameProps={{
            "aria-describedby": attributes["aria-describedby"],
            "aria-roledescription": "анкета",
            "aria-disabled": attributes["aria-disabled"],
          }}
        />
      </div>
    </div>
  );
}

function CardBody({
  candidate,
  lifted = false,
  nameRef,
  nameProps,
}: {
  candidate: BoardCandidate;
  lifted?: boolean;
  nameRef?: (node: HTMLElement | null) => void;
  nameProps?: React.AriaAttributes;
}) {
  const age = stageAge(candidate.status, candidate.stage_changed_at);
  return (
    <article
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card p-3 transition-shadow duration-200 hover:shadow-sm",
        lifted && "cursor-grabbing shadow-lg",
      )}
    >
      <PersonAvatar
        src={candidate.photo_thumb_url ?? candidate.photo_url}
        previewSrc={candidate.photo_preview_url}
        fallbackSrc={candidate.photo_url}
        name={candidate.full_name}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          ref={nameRef}
          {...nameProps}
          // Копия в переносимом слое — не цель для Tab.
          tabIndex={lifted ? -1 : undefined}
          href={`/people/candidates/${candidate.id}`}
          data-candidate-link={lifted ? undefined : candidate.id}
          onClick={(e) => e.stopPropagation()}
          className="truncate text-[13px] font-medium leading-5 transition-colors duration-200 hover:text-brand focus-visible:text-brand focus-visible:outline-none"
          data-tip={candidate.full_name}
          data-tip-overflow
        >
          {candidate.full_name}
        </Link>
        <span className="truncate text-[11px] leading-4 text-muted-foreground">
          {candidate.desired_position || "Должность не указана"}
        </span>
        {age && (
          <span
            className={cn(
              "text-[11px] leading-4 tabular-nums",
              age.overdueAfter !== null
                ? "font-medium text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
            data-tip={
              age.overdueAfter !== null
                ? overdueHint(age.overdueAfter, STATUSES[candidate.status])
                : undefined
            }
          >
            На этапе: {age.label.toLocaleLowerCase("ru")}
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * Стрелки влево и вправо ставят карточку в середину соседней колонки:
 * обычный шаг сенсора — 25 px, до соседней колонки пришлось бы жать
 * больше десяти раз. Вверх и вниз внутри колонки переносить некуда.
 */
const toNextColumn: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const step = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!step || !collisionRect) return undefined;
  event.preventDefault();
  const rects = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  if (!rects.length) return undefined;
  const center = collisionRect.left + collisionRect.width / 2;
  // Текущая колонка — та, над которой середина карточки, иначе ближайшая.
  let index = rects.findIndex((r) => center >= r.left && center <= r.right);
  if (index === -1)
    index = rects.reduce(
      (best, r, i) =>
        Math.abs(r.left + r.width / 2 - center) <
        Math.abs(rects[best].left + rects[best].width / 2 - center)
          ? i
          : best,
      0,
    );
  const target = rects[index + step];
  if (!target) return undefined;
  return {
    x: target.left + target.width / 2 - collisionRect.width / 2,
    y: currentCoordinates.y,
  };
};

/** `prefers-reduced-motion: reduce` с подпиской на смену настройки. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}
