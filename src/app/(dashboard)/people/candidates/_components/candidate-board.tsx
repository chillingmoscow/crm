"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { getCandidate, listCandidates } from "../actions";
import { HireDrawer } from "./hire-drawer";
import {
  useCandidateStatusChange,
  type CandidateStatusUpdate,
} from "./candidate-status-change";

/** Колонки доски — этапы по порядку воронки. */
const COLUMNS: CandidateStatus[] = ["new", "review", "interview", "trial", "hired", "rejected"];
/** Этапы в работе: показываем все анкеты, дольше всех ждущие — сверху. */
const ACTIVE: CandidateStatus[] = ["new", "review", "interview", "trial"];
/** «Не подходит» копится годами: на доске — последние, остальные в таблице. */
const DONE_LIMIT = 25;
const ACTIVE_LIMIT = 100;

type BoardCandidate = Candidate & Partial<CandidatePhotos>;
type Column = { rows: BoardCandidate[]; total: number };

const byStageAsc = (a: Candidate, b: Candidate) =>
  a.stage_changed_at.localeCompare(b.stage_changed_at);
const byStageDesc = (a: Candidate, b: Candidate) => byStageAsc(b, a);

/**
 * Доска кандидатов по этапам — второй вид списка рядом с таблицей. Карточку
 * переносят между колонками мышью, пальцем (долгое нажатие) или с
 * клавиатуры (пробел — взять, стрелки — перенести, пробел — положить).
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
}: {
  /** Поиск и условия списка — те же, что у таблицы; сортировка своя. */
  filters: Omit<ListFilters, "sort">;
  options: HiringOptions;
  permissions: CandidatePermissions;
  /** Меняется, когда список нужно перечитать (новые анкеты, удаление). */
  reloadKey: number;
  onStatusSaved: (saved: CandidateStatusUpdate) => void;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState<Record<CandidateStatus, Column> | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const chosen = (filters.status ?? []) as CandidateStatus[];
  const visible = chosen.length ? COLUMNS.filter((s) => chosen.includes(s)) : COLUMNS;
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setError("");
    const base = { ...filters, page: 0 } as const;
    const active = ACTIVE.filter((s) => !chosen.length || chosen.includes(s));
    // Принятые уходят в «Сотрудников» и в списке анкет их нет: колонка
    // «Принят на работу» — только место, куда переносят анкету для оформления.
    const done = (["rejected"] as const).filter((s) => !chosen.length || chosen.includes(s));
    const load = async () => {
      // Два запроса, а не пять: действия из браузера идут по очереди.
      const [activePage, ...donePages] = await Promise.all([
        active.length
          ? listCandidates({
              ...base,
              status: active,
              // «На этапе» по убыванию — дольше всех ждущие сверху.
              sort: [{ field: "stage_changed_at", direction: "desc" }],
              pageSize: ACTIVE_LIMIT,
            }).then(unwrapAction)
          : Promise.resolve(null),
        ...done.map((status) =>
          listCandidates({
            ...base,
            status: [status],
            // «На этапе» по возрастанию — последние отказы сверху.
            sort: [{ field: "stage_changed_at", direction: "asc" }],
            pageSize: DONE_LIMIT,
          }).then(unwrapAction),
        ),
      ]);
      const next = Object.fromEntries(
        COLUMNS.map((s) => [s, { rows: [] as BoardCandidate[], total: 0 }]),
      ) as Record<CandidateStatus, Column>;
      for (const row of activePage?.rows ?? []) next[row.status].rows.push(row);
      for (const s of ACTIVE) next[s].total = next[s].rows.length;
      done.forEach((status, i) => {
        next[status] = { rows: donePages[i].rows, total: donePages[i].total };
      });
      return next;
    };
    load()
      .then((next) => {
        if (!cancelled) setColumns(next);
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

  // Фото — отдельным запросом, как в таблице: без них остаются инициалы.
  const [photos, setPhotos] = useState<Record<string, CandidatePhotos>>({});
  const ids = useMemo(
    () => (columns ? COLUMNS.flatMap((s) => columns[s].rows.map((r) => r.id)) : []),
    [columns],
  );
  const idsKey = ids.join(",");
  useEffect(() => {
    if (!idsKey) return;
    const controller = new AbortController();
    const list = idsKey.split(",");
    const parts: string[][] = [];
    for (let i = 0; i < list.length; i += 100) parts.push(list.slice(i, i + 100));
    void Promise.all(
      parts.map((part) =>
        fetch(`/api/people/candidate-photos?ids=${part.join(",")}`, {
          signal: controller.signal,
        }).then((r) => (r.ok ? (r.json() as Promise<Record<string, CandidatePhotos>>) : {})),
      ),
    )
      .then((all) => {
        if (!controller.signal.aborted) setPhotos(Object.assign({}, ...all));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [idsKey]);

  const saved = useCallback(
    (update: CandidateStatusUpdate) => {
      setColumns((current) => {
        if (!current) return current;
        const all = COLUMNS.flatMap((s) => current[s].rows);
        const row = all.find((r) => r.id === update.id);
        if (!row || row.revision >= update.revision) return current;
        const moved: BoardCandidate = {
          ...row,
          ...update,
          stage_changed_at:
            update.status !== row.status ? new Date().toISOString() : row.stage_changed_at,
        };
        const next = { ...current };
        next[row.status] = {
          rows: current[row.status].rows.filter((r) => r.id !== row.id),
          total: Math.max(0, current[row.status].total - 1),
        };
        const target = next[moved.status];
        const rows = [...target.rows.filter((r) => r.id !== row.id), moved].sort(
          ACTIVE.includes(moved.status) ? byStageAsc : byStageDesc,
        );
        next[moved.status] = { rows, total: target.total + 1 };
        return next;
      });
      onStatusSaved(update);
    },
    [onStatusSaved],
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
    if (candidate.status !== "trial" || candidate.hired_user_id) return "Сначала стажировка";
    return null;
  };

  const [dragging, setDragging] = useState<BoardCandidate | null>(null);
  const [over, setOver] = useState<CandidateStatus | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // На телефоне — долгое нажатие, чтобы доска прокручивалась пальцем.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    // Enter оставляем ссылке на анкету: взять и положить — пробелом.
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );
  const findRow = (id: string) =>
    columns ? COLUMNS.flatMap((s) => columns[s].rows).find((r) => r.id === id) ?? null : null;
  const onDragStart = (event: DragStartEvent) => setDragging(findRow(String(event.active.id)));
  const onDragOver = (event: DragOverEvent) =>
    setOver((event.over?.id as CandidateStatus | undefined) ?? null);
  const onDragEnd = (event: DragEndEvent) => {
    const row = findRow(String(event.active.id));
    const target = event.over?.id as CandidateStatus | undefined;
    setDragging(null);
    setOver(null);
    if (!row || !target || target === row.status) return;
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
              "Чтобы перенести анкету на другой этап, нажмите пробел, выберите колонку стрелками и нажмите пробел ещё раз. Escape — отмена.",
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
                count={status === "hired" ? null : column ? column.total : null}
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
                      busy={pending?.id === row.id || hireLoading === row.id}
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
        <DragOverlay dropAnimation={{ duration: 240, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }}>
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
            refresh();
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
  // Принятых не переносим: этап меняется только оформлением, как в таблице.
  const locked = candidate.status === "hired";
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: candidate.id,
    disabled: locked || busy,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="анкета"
      aria-label={`${candidate.full_name}, ${STATUSES[candidate.status]}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        onOpen();
      }}
      className={cn(
        "rounded-lg outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-brand",
        locked ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        busy && "pointer-events-none opacity-60",
      )}
      style={{ touchAction: "manipulation" }}
    >
      {/* Появление — на внутреннем слое: анимация с fill both перекрыла бы
          прозрачность переносимой карточки. */}
      <div className="table-row-in" style={{ animationDelay: `${Math.min(index, 15) * 40}ms` }}>
        <CardBody candidate={candidate} />
      </div>
    </div>
  );
}

function CardBody({ candidate, lifted = false }: { candidate: BoardCandidate; lifted?: boolean }) {
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
          href={`/people/candidates/${candidate.id}`}
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
