"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  defaultDropAnimationSideEffects,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { candidateError } from "@/lib/candidates/errors";
import {
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_KEYS,
  type CandidateBoardData,
  type CandidateStage,
  type CandidatePage,
  type ListFilters,
} from "@/lib/candidates/types";
import {
  loadCandidateBoard,
  listCandidates,
  updateCandidate,
} from "../actions";
import { CandidateCard, CandidateCardBody } from "./candidate-card";
import type { CandidateField } from "./candidate-view";

export function CandidateBoard({
  initial,
  filters,
  pageSize,
  fields,
  active,
  canManage,
  onTotalChange,
  onChanged,
}: {
  initial: CandidateBoardData;
  filters: ListFilters;
  pageSize: number;
  fields: CandidateField[];
  active: boolean;
  canManage: boolean;
  onTotalChange: (total: number) => void;
  onChanged: () => void;
}) {
  const [board, setBoard] = useState(initial),
    [filterLoading, setFilterLoading] = useState(false),
    [loading, setLoading] = useState<Partial<Record<CandidateStage, boolean>>>(
      {},
    ),
    [activeId, setActiveId] = useState<string | null>(null),
    [moving, setMoving] = useState<string | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [reduced, setReduced] = useState(false);
  const queryKey = JSON.stringify([filters, pageSize, reload]);
  const lastQuery = useRef(queryKey),
    epoch = useRef(0),
    requestId = useRef<Partial<Record<CandidateStage, number>>>({});
  const nodes = useRef(new Map<string, HTMLElement>()),
    rectangles = useRef(new Map<string, DOMRect>()),
    skipAnimation = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const stages = CANDIDATE_STAGE_KEYS.filter(
    (s) => !filters.status || filters.status === s,
  );
  const dragging = activeId
    ? Object.values(board.columns)
        .flatMap((c) => c.rows)
        .find((c) => c.id === activeId)
    : null;
  const disabled =
    !canManage ||
    !!error ||
    filterLoading ||
    !!moving ||
    Object.values(loading).some(Boolean);
  useEffect(() => {
    onTotalChange(board.total);
  }, [board.total, onTotalChange]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!active || lastQuery.current === queryKey) return;
    const version = ++epoch.current;
    let cancelled = false;
    setFilterLoading(true);
    setLoading({});
    setError("");
    loadCandidateBoard(filters, {}, pageSize)
      .then((next) => {
        if (!cancelled && epoch.current === version) {
          lastQuery.current = queryKey;
          setBoard(next);
        }
      })
      .catch((e) => {
        if (!cancelled && epoch.current === version)
          setError(candidateError(e, "Не удалось загрузить столбцы."));
      })
      .finally(() => {
        if (!cancelled && epoch.current === version) setFilterLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The serialized key includes every filter; switching views preserves independent pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, active, reload]);
  useLayoutEffect(() => {
    if (!active) {
      rectangles.current.clear();
      return;
    }
    const next = new Map(
      [...nodes.current].map(([id, node]) => [
        id,
        node.getBoundingClientRect(),
      ]),
    );
    if (!reduced)
      for (const [id, rect] of next) {
        const before = rectangles.current.get(id),
          node = nodes.current.get(id);
        if (before && node && id !== skipAnimation.current) {
          const x = before.left - rect.left,
            y = before.top - rect.top;
          if (Math.abs(x) > 1 || Math.abs(y) > 1)
            node.animate(
              [
                { transform: `translate(${x}px,${y}px)` },
                { transform: "translate(0,0)" },
              ],
              { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" },
            );
        }
      }
    rectangles.current.clear();
    skipAnimation.current = null;
  }, [board, active, fields, reduced]);
  const register = (id: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
  const applyColumns = (updates: [CandidateStage, CandidatePage][]) => {
    rectangles.current = new Map(
      [...nodes.current].map(([id, node]) => [
        id,
        node.getBoundingClientRect(),
      ]),
    );
    setBoard((current) => {
      const columns = { ...current.columns };
      for (const [stage, data] of updates) columns[stage] = data;
      return {
        columns,
        total: Object.values(columns).reduce((n, c) => n + c.total, 0),
      };
    });
  };
  const loadPage = async (stage: CandidateStage, page: number) => {
    const version = epoch.current,
      id = (requestId.current[stage] ?? 0) + 1;
    requestId.current[stage] = id;
    setLoading((current) => ({ ...current, [stage]: true }));
    try {
      const data = await listCandidates({
        ...filters,
        status: stage,
        page,
        pageSize,
        view: "board",
      });
      if (version === epoch.current && id === requestId.current[stage])
        applyColumns([[stage, data]]);
    } catch (e) {
      if (version === epoch.current)
        toast.error(candidateError(e, "Не удалось открыть страницу столбца."));
    } finally {
      if (version === epoch.current && id === requestId.current[stage])
        setLoading((current) => ({ ...current, [stage]: false }));
    }
  };
  const move = async ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null);
    const target = String(over?.id ?? "") as CandidateStage;
    const c = Object.values(board.columns)
      .flatMap((column) => column.rows)
      .find((c) => c.id === dragged.id);
    if (
      disabled ||
      !c ||
      c.status === target ||
      !CANDIDATE_STAGE_KEYS.includes(target) ||
      c.status === "hired"
    )
      return;
    const source = c.status,
      before = board,
      version = epoch.current;
    skipAnimation.current = c.id;
    setMoving(c.id);
    const moved = {
      ...c,
      status: target,
      revision: c.revision + 1,
      stage_changed_at: new Date().toISOString(),
    };
    applyColumns([
      [
        source,
        {
          ...board.columns[source],
          total: board.columns[source].total - 1,
          rows: board.columns[source].rows.filter((row) => row.id !== c.id),
        },
      ],
      [
        target,
        {
          ...board.columns[target],
          page: 0,
          total: board.columns[target].total + 1,
          rows: [
            moved,
            ...board.columns[target].rows.filter((row) => row.id !== c.id),
          ].slice(0, pageSize),
        },
      ],
    ]);
    let committed = false;
    try {
      await updateCandidate(c.id, { revision: c.revision, status: target });
      committed = true;
      onChanged();
      if (version !== epoch.current) return;
      const updates = await Promise.all(
        [source, target].map(
          async (stage) =>
            [
              stage,
              await listCandidates({
                ...filters,
                status: stage,
                page: stage === target ? 0 : before.columns[source].page,
                pageSize,
                view: "board",
              }),
            ] as [CandidateStage, CandidatePage],
        ),
      );
      if (version === epoch.current) applyColumns(updates);
    } catch (e) {
      if (version === epoch.current && !committed) {
        rectangles.current = new Map(
          [...nodes.current].map(([id, node]) => [
            id,
            node.getBoundingClientRect(),
          ]),
        );
        setBoard(before);
      }
      toast.error(
        committed
          ? "Статус сохранён, но обновить столбцы не удалось. Повторите загрузку."
          : candidateError(e, "Не удалось переместить кандидата."),
      );
      if (committed && version === epoch.current)
        setError(
          "Статус сохранён. Обновите столбцы, чтобы проверить страницы.",
        );
    } finally {
      setMoving(null);
    }
  };
  return (
    <div className="min-w-0 space-y-3" aria-busy={filterLoading}>
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReload((n) => n + 1)}
          >
            Повторить загрузку
          </Button>
        </div>
      ) : null}
      {filterLoading ? (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-3 motion-safe:animate-spin" />
          Обновляем столбцы…
        </p>
      ) : null}
      <DndContext
        id="candidates-board"
        sensors={sensors}
        collisionDetection={(args) => {
          const hits = pointerWithin(args);
          return hits.length ? hits : rectIntersection(args);
        }}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={move}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Нажмите пробел, чтобы взять карточку. Стрелками переместите её в нужный столбец, затем снова нажмите пробел. Escape отменяет перенос.",
          },
          announcements: {
            onDragStart: () => "Карточка выбрана для переноса.",
            onDragOver: ({ over }) =>
              over
                ? `Перенести в столбец «${CANDIDATE_STAGES[String(over.id) as CandidateStage]}».`
                : "Карточка вне столбцов.",
            onDragEnd: ({ over }) =>
              over
                ? `Перенос в столбец «${CANDIDATE_STAGES[String(over.id) as CandidateStage]}».`
                : "Перенос отменён.",
            onDragCancel: () => "Перенос отменён.",
          },
        }}
      >
        <div className="flex min-w-0 items-start gap-4 overflow-x-auto px-0.5 pb-4 [scrollbar-width:thin]">
          {stages.map((stage) => (
            <BoardColumn
              key={stage}
              stage={stage}
              data={board.columns[stage]}
              loading={!!loading[stage]}
              disabled={!!error || filterLoading || !!moving}
              onPage={(page) => {
                void loadPage(stage, page);
              }}
            >
              {board.columns[stage].rows.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  fields={fields}
                  disabled={disabled}
                  saving={moving === c.id}
                  register={register}
                />
              ))}
            </BoardColumn>
          ))}
        </div>
        <DragOverlay
          dropAnimation={
            reduced
              ? null
              : {
                  duration: 200,
                  easing: "cubic-bezier(.2,.8,.2,1)",
                  sideEffects: defaultDropAnimationSideEffects({
                    styles: { active: { opacity: "0" } },
                  }),
                }
          }
        >
          {dragging ? (
            <div className="w-full rounded-lg border border-brand/40 bg-card p-3 shadow-md">
              <CandidateCardBody candidate={dragging} fields={fields} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
function BoardColumn({
  stage,
  data,
  loading,
  disabled,
  onPage,
  children,
}: {
  stage: CandidateStage;
  data: CandidatePage;
  loading: boolean;
  disabled: boolean;
  onPage: (page: number) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled });
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <section
      ref={setNodeRef}
      aria-label={CANDIDATE_STAGES[stage]}
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-xl border border-transparent bg-muted/40 p-3 transition-colors motion-reduce:transition-none",
        isOver && "border-brand/40 bg-brand/5",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-medium">{CANDIDATE_STAGES[stage]}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {data.total}
        </span>
      </div>
      <div
        className={cn(
          "max-h-[calc(100dvh-260px)] min-h-28 space-y-2 overflow-y-auto overscroll-contain px-0.5 py-0.5 transition-opacity motion-reduce:transition-none [scrollbar-width:thin]",
          loading && "opacity-50",
        )}
        aria-busy={loading}
      >
        {children}
        {!data.rows.length ? (
          <p className="px-1 py-8 text-center text-xs text-muted-foreground">
            Анкет пока нет
          </p>
        ) : null}
      </div>
      <div
        className="mt-3 flex items-center justify-between gap-1 border-t pt-2 text-xs text-muted-foreground"
        aria-label={`Страницы: ${CANDIDATE_STAGES[stage]}`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Предыдущая страница: ${CANDIDATE_STAGES[stage]}`}
          disabled={disabled || loading || data.page === 0}
          onClick={() => onPage(data.page - 1)}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="tabular-nums" role="status">
          {loading ? "Загрузка…" : `${data.page + 1} из ${pages}`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Следующая страница: ${CANDIDATE_STAGES[stage]}`}
          disabled={disabled || loading || data.page + 1 >= pages}
          onClick={() => onPage(data.page + 1)}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}
