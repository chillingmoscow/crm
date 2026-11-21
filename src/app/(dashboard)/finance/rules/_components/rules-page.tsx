"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, SearchX, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { TableControls, TablePageHeader } from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { buildRuleContext, buildRuleNames, type RuleDirectories } from "@/lib/finance/posting-rules/context";
import { ruleNeedsAttention, normalizeRuleText } from "@/lib/finance/posting-rules/evaluate";
import { describePostingRule } from "@/lib/finance/posting-rules/phrase";
import { reorderPostingRules, setPostingRuleEnabled } from "@/lib/finance/posting-rules/server";
import type { PostingRule } from "@/lib/finance/posting-rules/types";
import { cn } from "@/lib/utils";

import { RuleSheet } from "./rule-sheet";

type Row = PostingRule & { conditionsText: string; actionsText: string; attention: boolean };

export function RulesPage({
  rules,
  directories,
  allowedVenueIds,
  canManage,
  initialRuleId,
}: {
  rules: PostingRule[];
  directories: RuleDirectories;
  allowedVenueIds: string[] | null;
  canManage: boolean;
  initialRuleId: string | null;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(() => rules.map((r) => r.id));
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; ruleId: string | null }>(() => ({
    open: Boolean(initialRuleId && rules.some((r) => r.id === initialRuleId)),
    ruleId: initialRuleId,
  }));
  const [pending, startTransition] = useTransition();

  // Сервер прислал новый список (после сохранения) — порядок берём оттуда.
  useEffect(() => setOrder(rules.map((r) => r.id)), [rules]);

  const rows = useMemo<Row[]>(() => {
    const ctx = buildRuleContext(directories, allowedVenueIds);
    const names = buildRuleNames(directories, allowedVenueIds);
    const byId = new Map(rules.map((r) => [r.id, r]));
    return order
      .map((id) => byId.get(id))
      .filter((r): r is PostingRule => Boolean(r))
      .map((rule) => {
        const phrase = describePostingRule(rule, names);
        return {
          ...rule,
          conditionsText: phrase.conditions,
          actionsText: phrase.actions,
          attention: ruleNeedsAttention(rule, ctx),
        };
      });
  }, [rules, order, directories, allowedVenueIds]);

  const query = normalizeRuleText(search);
  const visible = query
    ? rows.filter((r) =>
        normalizeRuleText(`${r.name ?? ""} ${r.conditionsText} ${r.actionsText}`).includes(query),
      )
    : rows;
  const canDrag = canManage && !query && !pending;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const previous = order;
    const next = arrayMove(order, from, to);
    setOrder(next);
    startTransition(async () => {
      const result = await reorderPostingRules(next);
      if (result.error) {
        setOrder(previous);
        toast.error(result.error);
        router.refresh();
      }
    });
  };

  const toggle = (rule: Row, enabled: boolean) => {
    startTransition(async () => {
      const result = await setPostingRuleEnabled(rule.id, enabled);
      if (result.error) toast.error(result.error);
    });
  };

  const openRule = (ruleId: string | null) => setSheet({ open: true, ruleId });
  const sheetRule = sheet.ruleId ? (rules.find((r) => r.id === sheet.ruleId) ?? null) : null;

  let body: React.ReactNode;
  if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Wand2}
        title="Правил пока нет"
        description="Правило само заполнит статью, контрагента или заведение, когда вы вводите операцию"
        action={canManage ? <Button onClick={() => openRule(null)}>Добавить правило</Button> : undefined}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        icon={SearchX}
        title="Ничего не нашлось"
        description="Поиск ищет по названию и тексту правила"
        action={
          <Button variant="outline" onClick={() => setSearch("")}>
            Сбросить поиск
          </Button>
        }
      />
    );
  } else {
    body = (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol className="divide-y rounded-lg border bg-card" aria-label="Правила сверху вниз">
            {visible.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                number={rows.indexOf(rule) + 1}
                canDrag={canDrag}
                canManage={canManage}
                busy={pending}
                onOpen={() => openRule(rule.id)}
                onToggle={(enabled) => toggle(rule, enabled)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "Правила" }]} />
      <TablePageHeader
        title="Правила"
        count={query ? `${visible.length} из ${rows.length}` : rows.length}
        actions={
          <TableControls
            search={{
              value: search,
              onChange: setSearch,
              open: searchOpen,
              onOpenChange: setSearchOpen,
            }}
            primaryActions={canManage ? <Button onClick={() => openRule(null)}>Добавить правило</Button> : null}
          />
        }
      />
      {body}
      <RuleSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((prev) => ({ ...prev, open }))}
        rule={sheetRule}
        directories={directories}
        allowedVenueIds={allowedVenueIds}
        canManage={canManage}
      />
    </PageFrame>
  );
}

function RuleRow({
  rule,
  number,
  canDrag,
  canManage,
  busy,
  onOpen,
  onToggle,
}: {
  rule: Row;
  number: number;
  canDrag: boolean;
  canManage: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
    disabled: !canDrag,
  });
  const label = rule.name ?? `Правило ${number}`;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex cursor-pointer items-start gap-3 bg-card px-3 py-3 first:rounded-t-lg last:rounded-b-lg hover:bg-muted/40 sm:px-4",
        isDragging && "relative z-10 shadow-md",
      )}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, [role=switch]")) return;
        onOpen();
      }}
    >
      {canManage ? (
        <button
          type="button"
          className={cn(
            "flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground/70",
            canDrag ? "cursor-grab hover:bg-muted hover:text-foreground active:cursor-grabbing" : "opacity-40",
          )}
          aria-label={`Переместить «${label}»`}
          disabled={!canDrag}
          data-tip={canDrag ? undefined : "Сбросьте поиск, чтобы менять порядок"}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
      <span className="mt-1.5 w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{number}</span>
      <div className={cn("min-w-0 flex-1 space-y-1 py-1", !rule.enabled && "opacity-60")}>
        {rule.name ? <p className="truncate text-sm font-medium">{rule.name}</p> : null}
        <p className="text-sm">
          <span className="text-muted-foreground">Если </span>
          {rule.conditionsText}
          <span className="text-muted-foreground"> → </span>
          <span className="font-medium">{rule.actionsText || "ничего не заполняет"}</span>
        </p>
        {rule.attention || !rule.enabled ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {rule.attention ? (
              <StatusBadge tone="warning" tip="Правило ссылается на запись в архиве или ничего не заполняет — оно не срабатывает">
                Требует внимания
              </StatusBadge>
            ) : null}
            {!rule.enabled ? <StatusBadge>Выключено</StatusBadge> : null}
          </div>
        ) : null}
      </div>
      <Switch
        className="mt-1.5 shrink-0"
        checked={rule.enabled}
        onCheckedChange={onToggle}
        disabled={!canManage || busy}
        aria-label={rule.enabled ? `Выключить «${label}»` : `Включить «${label}»`}
      />
    </li>
  );
}
