"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BarChart3, ChevronRight, GripVertical, Lock, Plus, ScrollText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { createKbPage, moveKbPageInTree } from "@/lib/knowledge/pages";
import { KbSearchTrigger } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
import { KbImportDialog } from "@/app/(dashboard)/knowledge/_components/kb-import-dialog";
import { KbTemplatePicker } from "@/app/(dashboard)/knowledge/_components/kb-template-picker";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type { KbFavoritePage } from "@/lib/knowledge/favorites";
import type { KbTreeNode } from "@/types/knowledge";
import { Star } from "lucide-react";

interface KbTreeNavProps {
  nodes: KbTreeNode[];
  /** Список favorited-страниц текущего юзера. Рендерится отдельной
   *  секцией над «Страницы». Пустой список — секция не показывается. */
  favorites?: KbFavoritePage[];
  /** Whether to show the «Корзина» link at the bottom of the tree.
   *  Driven by `kb.delete_pages` permission, gated server-side in
   *  the layout. The trash route itself also re-checks. */
  canSeeTrash?: boolean;
  /** `org.view_audit` permission. Показывает «Журнал» link рядом с
   *  «Корзина» внизу дерева. Сама страница /knowledge/audit re-check'ает. */
  canViewAudit?: boolean;
  /** `kb.view_analytics` permission (миграция 077). Показывает
   *  «Аналитика» link рядом с «Журнал». Страница /knowledge/analytics
   *  re-check'ает. */
  canViewAnalytics?: boolean;
  /** `kb.import_pages` (миграция 069). Показывает Upload-кнопку рядом
   *  с «+ Новая страница». Server-action всё равно проверяет — это
   *  UX-слой. */
  canImport?: boolean;
  /** `kb.create_pages` — могут ли вообще создавать страницы (включая
   *  из шаблона). Без него picker не показывается. */
  canCreate?: boolean;
  /** `kb.manage_templates` — управление шаблонами (delete-кнопка
   *  внутри picker'а). */
  canManageTemplates?: boolean;
}

/** Drop-zone тип, кодируемый в droppable id'шниках:
 *    `pos:<id>:before`  — sibling-before target'а
 *    `pos:<id>:child`   — стать ребёнком target'а
 *    `pos:<id>:after`   — sibling-after target'а
 *    `root`             — стать root-страницей */
type DropZone = "before" | "child" | "after";

interface ParsedDropTarget {
  kind: "item" | "root";
  /** id целевой страницы — есть только для kind="item" */
  targetId?: string;
  /** Для kind="item" */
  zone?: DropZone;
}

function parseDropId(id: string | number | null | undefined): ParsedDropTarget | null {
  if (id == null) return null;
  const s = String(id);
  if (s === "root") return { kind: "root" };
  const m = /^pos:([^:]+):(before|child|after)$/.exec(s);
  if (!m) return null;
  return { kind: "item", targetId: m[1], zone: m[2] as DropZone };
}

function makeDropId(targetId: string, zone: DropZone): string {
  return `pos:${targetId}:${zone}`;
}

/**
 * KB tree navigator. Notion-style nested page list with:
 *  ─ chevron expand/collapse for nodes with children
 *  ─ active state when the URL slug matches
 *  ─ "+" button on hover to create a child page
 *  ─ drag-handle (::: на hover) для full-tree reorder. Поддерживается:
 *      • drop в TOP-edge соседнего item'а → sibling-before
 *      • drop в BOTTOM-edge → sibling-after
 *      • drop в CENTER row'а → стать его child'ом (cross-parent move)
 *      • drop в root-area под деревом → стать root-страницей
 *    Cycle prevention: dragged item + его потомки исключаются из
 *    droppable. Атомарный move через kb_move_page RPC (миграция 073).
 *
 * Expansion state lives in the parent so toggles use functional
 * setState (no stale closures). Ancestors of the active page are
 * auto-added to the expanded set whenever activeSlug changes.
 */
export function KbTreeNav({
  nodes,
  favorites = [],
  canSeeTrash = false,
  canViewAudit = false,
  canViewAnalytics = false,
  canImport = false,
  canCreate = false,
  canManageTemplates = false,
}: KbTreeNavProps) {
  const params = useParams<{ slug?: string }>();
  const activeSlug = params?.slug;

  // Local mirror of `nodes` для оптимистичного reorder. При успехе
  // server-data догонит. При ошибке — откатываем к props.nodes.
  const [localNodes, setLocalNodes] = useState(nodes);
  useEffect(() => setLocalNodes(nodes), [nodes]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => expandAncestors(nodes, activeSlug),
  );

  // Auto-expand ancestors of the active page whenever the URL changes
  // OR the tree gets a new node added (e.g. just-created child).
  useEffect(() => {
    const ancestors = expandAncestors(nodes, activeSlug);
    if (ancestors.size === 0) return;
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeSlug, nodes]);

  // Activation distance 5px — иначе случайные click'и улетают в drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // ID того, что сейчас тащим (для DragOverlay + filter'а droppables —
  // dragged item + его потомки выпадают из targets для cycle prevention).
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // Hovered drop target — для визуального feedback'а (insertion-line /
  // child-highlight). Парсится из event.over.id в onDragOver.
  const [overTarget, setOverTarget] = useState<ParsedDropTarget | null>(null);

  // Множество id, которые нельзя droppать на dragged item (он сам +
  // все его потомки — иначе цикл иерархии).
  const blockedTargets = useMemo(() => {
    if (!activeDragId) return null;
    const node = findNodeById(localNodes, activeDragId);
    if (!node) return new Set<string>([activeDragId]);
    return collectDescendantIds(node, true);
  }, [activeDragId, localNodes]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveDragId(id);
    setOverTarget(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverTarget(parseDropId(event.over?.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const target = parseDropId(event.over?.id);
      const draggedId = String(event.active.id);
      setActiveDragId(null);
      setOverTarget(null);

      if (!target) return;
      // Cycle protection (двойная — также enforced в RPC).
      if (target.kind === "item" && blockedTargets?.has(target.targetId!)) {
        toast.info("Нельзя поместить страницу внутрь её же потомка");
        return;
      }

      // Compute target parent + new sibling order локально (для
      // optimistic update и для argument'а RPC).
      const draggedNode = findNodeById(localNodes, draggedId);
      if (!draggedNode) return;

      let newParentId: string | null;
      let referenceTargetId: string | null = null;
      let zone: DropZone | "last" = "last";

      if (target.kind === "root") {
        newParentId = null;
      } else {
        const targetId = target.targetId!;
        zone = target.zone!;
        if (zone === "child") {
          newParentId = targetId;
        } else {
          // before/after — sibling того же родителя что у target'а.
          const parentChain = findParentChain(localNodes, targetId);
          if (!parentChain) return;
          newParentId = parentChain.parentId;
          referenceTargetId = targetId;
        }
      }

      // Текущие siblings под новым parent'ом (БЕЗ dragged-узла, мы
      // его как раз вставляем). Для root - top-level узлы.
      const existingSiblings = (
        newParentId === null
          ? localNodes
          : (findNodeById(localNodes, newParentId)?.children ?? [])
      ).filter((n) => n.id !== draggedId);

      // Insert position в existingSiblings.
      let insertIdx: number;
      if (target.kind === "root" || zone === "child" || zone === "last") {
        insertIdx = existingSiblings.length;
      } else {
        const refIdx = existingSiblings.findIndex((s) => s.id === referenceTargetId);
        if (refIdx === -1) {
          insertIdx = existingSiblings.length;
        } else {
          insertIdx = zone === "before" ? refIdx : refIdx + 1;
        }
      }

      const newSiblings = [
        ...existingSiblings.slice(0, insertIdx),
        draggedNode,
        ...existingSiblings.slice(insertIdx),
      ];

      // No-op detection: если parent тот же и порядок не изменился —
      // не дёргаем server.
      const oldChain = findParentChain(localNodes, draggedId);
      if (oldChain && oldChain.parentId === newParentId) {
        const oldOrder = oldChain.siblings.map((s) => s.id).join(",");
        const newOrder = newSiblings.map((s) => s.id).join(",");
        if (oldOrder === newOrder) return;
      }

      // Optimistic apply: remove draggedNode from old parent, set
      // newSiblings под newParentId. Затем — auto-expand нового
      // parent'а если был свёрнут (UX: после drop'а юзер видит, что
      // страница теперь внутри).
      const next = applyMoveToTree(
        localNodes,
        draggedId,
        newParentId,
        newSiblings,
      );
      setLocalNodes(next);
      if (newParentId !== null) {
        setExpanded((prev) => {
          if (prev.has(newParentId!)) return prev;
          const nextSet = new Set(prev);
          nextSet.add(newParentId!);
          return nextSet;
        });
      }

      const newSiblingOrder = newSiblings.map((s) => s.id);
      void moveKbPageInTree({
        id: draggedId,
        newParentId,
        newSiblingOrder,
      }).then(({ error }) => {
        if (error) {
          toast.error(error);
          setLocalNodes(nodes); // revert на server-truth
        }
      });
    },
    [blockedTargets, localNodes, nodes, setExpanded],
  );

  // Найти dragged-node для DragOverlay (показывать floating-preview).
  const draggedNode = activeDragId
    ? findNodeById(localNodes, activeDragId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveDragId(null);
        setOverTarget(null);
      }}
    >
      <div className="flex flex-col h-full">
        <div className="flex flex-col gap-2 p-3 pb-2">
          {favorites.length > 0 && (
            <KbFavoritesSection favorites={favorites} activeSlug={activeSlug} />
          )}
          <KbTreeHeader
            canImport={canImport}
            canCreate={canCreate}
            canManageTemplates={canManageTemplates}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          {localNodes.length === 0 ? (
            <KbTreeEmpty />
          ) : (
            <ul className="flex flex-col gap-0.5" role="tree">
              {localNodes.map((node) => (
                <KbTreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  activeSlug={activeSlug}
                  blockedTargets={blockedTargets}
                  overTarget={overTarget}
                  isDraggingAny={activeDragId !== null}
                />
              ))}
              {/* Root drop-zone — невидимый strip, активируется только
                  во время drag и только если dragged-page НЕ уже на
                  root-уровне (иначе drop был бы no-op). */}
              {activeDragId && (
                <KbRootDropZone
                  active={overTarget?.kind === "root"}
                  enabled={
                    findParentChain(localNodes, activeDragId)?.parentId !== null
                  }
                />
              )}
            </ul>
          )}
        </div>

        {(canSeeTrash || canViewAudit || canViewAnalytics) && (
          <div className="mt-auto h-16 px-2 border-t border-sidebar-border flex items-center gap-1">
            {canSeeTrash && (
              <Link
                href="/knowledge/trash"
                className="flex flex-1 items-center gap-2 rounded-lg p-2
                           text-sm text-muted-foreground
                           hover:bg-sidebar-accent hover:text-foreground transition-colors"
              >
                <Trash2 className="size-4 shrink-0" />
                Корзина
              </Link>
            )}
            {canViewAudit && (
              <Link
                href="/knowledge/audit"
                className="flex flex-1 items-center gap-2 rounded-lg p-2
                           text-sm text-muted-foreground
                           hover:bg-sidebar-accent hover:text-foreground transition-colors"
              >
                <ScrollText className="size-4 shrink-0" />
                Журнал
              </Link>
            )}
            {canViewAnalytics && (
              <Link
                href="/knowledge/analytics"
                className="flex flex-1 items-center gap-2 rounded-lg p-2
                           text-sm text-muted-foreground
                           hover:bg-sidebar-accent hover:text-foreground transition-colors"
              >
                <BarChart3 className="size-4 shrink-0" />
                Аналитика
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Floating cursor-preview под мышкой во время drag'а. */}
      <DragOverlay dropAnimation={null}>
        {draggedNode ? (
          <div
            className="rounded-md bg-sidebar shadow-md border border-sidebar-border
                       px-2.5 py-1.5 text-[13px] font-medium text-sidebar-foreground
                       flex items-center gap-2 max-w-[260px]"
          >
            <KbPageIcon
              icon={draggedNode.icon}
              color={draggedNode.icon_color}
              size={14}
            />
            <span className="truncate">
              {draggedNode.title || "Без названия"}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Невидимый strip под последним top-level item'ом — droppable с
 *  id="root". Превращается в подсвеченную линию когда юзер тащит
 *  туда курсор. Скрыт, если drag не активен или dragged-page и так
 *  на root-уровне (drop был бы no-op). */
function KbRootDropZone({
  active,
  enabled,
}: {
  active: boolean;
  enabled: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: "root", disabled: !enabled });
  if (!enabled) return null;
  return (
    <li ref={setNodeRef} className="list-none" aria-label="Перенести в root">
      <div
        className={cn(
          "h-10 mx-2 mt-2 rounded-md border-2 border-dashed transition-colors",
          active
            ? "border-brand bg-brand/10"
            : "border-transparent hover:border-sidebar-border",
        )}
      >
        {active && (
          <div className="h-full flex items-center justify-center text-[11px] font-medium text-brand">
            Перенести на верхний уровень
          </div>
        )}
      </div>
    </li>
  );
}

function KbFavoritesSection({
  favorites,
  activeSlug,
}: {
  favorites: KbFavoritePage[];
  activeSlug?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 px-2 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        <Star className="size-3 fill-current text-yellow-500/70" />
        Избранное
      </div>
      {favorites.map((p) => {
        const isActive = activeSlug === p.slug;
        return (
          <Link
            key={p.id}
            href={`/knowledge/${p.slug}`}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
              "text-sidebar-foreground hover:bg-sidebar-accent",
              isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            title={p.title}
          >
            <span className="size-5 shrink-0 inline-flex items-center justify-center">
              <KbPageIcon icon={p.icon} color={p.icon_color} size={14} />
            </span>
            <span className="flex-1 truncate">{p.title || "Без названия"}</span>
          </Link>
        );
      })}
    </div>
  );
}

function KbTreeHeader({
  canImport = false,
  canCreate = false,
  canManageTemplates = false,
}: {
  canImport?: boolean;
  canCreate?: boolean;
  canManageTemplates?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const onCreateRoot = async () => {
    setCreating(true);
    const { slug, error } = await createKbPage({});
    setCreating(false);
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать страницу");
      return;
    }
    router.push(`/knowledge/${slug}`);
  };

  return (
    <div className="flex items-center justify-between px-2 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wider
                       text-muted-foreground/70">
        Страницы
      </span>
      <div className="flex items-center gap-0.5">
        <KbSearchTrigger />
        {canCreate && (
          <KbTemplatePicker
            parentId={null}
            canManageTemplates={canManageTemplates}
          />
        )}
        {canImport && <KbImportDialog parentId={null} />}
        <IconTooltip label="Новая страница">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Новая страница"
            onClick={onCreateRoot}
            disabled={creating}
          >
            <Plus className="size-3.5" />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}

function KbTreeEmpty() {
  return (
    <p className="px-2 py-3 text-sm text-muted-foreground">
      Пока нет страниц. Нажмите <kbd className="rounded border px-1">+</kbd>{" "}
      выше, чтобы создать первую.
    </p>
  );
}

interface KbTreeItemProps {
  node: KbTreeNode;
  depth: number;
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  activeSlug?: string;
  /** Set of page-id, которые сейчас «нельзя droppать» (= dragged
   *  page + её потомки). Disable'ит droppables на этих элементах
   *  чтобы избежать cycle и no-op self-drop'а. */
  blockedTargets: Set<string> | null;
  /** Текущий hovered drop-target (для visual feedback'а). */
  overTarget: ParsedDropTarget | null;
  /** Идёт ли drag прямо сейчас (для условной активации drop-zones). */
  isDraggingAny: boolean;
}

function KbTreeItem({
  node,
  depth,
  expanded,
  setExpanded,
  activeSlug,
  blockedTargets,
  overTarget,
  isDraggingAny,
}: KbTreeItemProps) {
  const router = useRouter();
  const isActive = activeSlug === node.slug;
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const [creating, setCreating] = useState(false);
  const isBlocked = blockedTargets?.has(node.id) ?? false;

  // Draggable handle (грип). Источник drag'а — кнопка ::: , как
  // раньше. setActivatorNodeRef нужен чтобы dnd-kit использовал её
  // для расчёта drag-event'а, а не весь li.
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({ id: node.id });

  // 3 droppable strip'а: before/child/after. Disabled если этот item —
  // dragged-сам (или его потомок). Активны только во время drag'а.
  const beforeDrop = useDroppable({
    id: makeDropId(node.id, "before"),
    disabled: isBlocked || !isDraggingAny,
  });
  const childDrop = useDroppable({
    id: makeDropId(node.id, "child"),
    disabled: isBlocked || !isDraggingAny,
  });
  const afterDrop = useDroppable({
    id: makeDropId(node.id, "after"),
    disabled: isBlocked || !isDraggingAny,
  });

  // Visual: какая zone сейчас hovered (для рендера insertion-line /
  // child-highlight). Сравниваем по target.id и zone.
  const hoveredZone =
    overTarget?.kind === "item" && overTarget.targetId === node.id
      ? overTarget.zone
      : null;

  // Functional setState — bullet-proof against stale closures during
  // parallel toggles or quick re-renders after server actions.
  const toggle = useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    },
    [node.id, setExpanded],
  );

  const onCreateChild = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCreating(true);
    const { slug, error } = await createKbPage({ parent_id: node.id });
    setCreating(false);
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать подстраницу");
      return;
    }
    setExpanded((prev) => {
      if (prev.has(node.id)) return prev;
      const next = new Set(prev);
      next.add(node.id);
      return next;
    });
    router.push(`/knowledge/${slug}`);
  };

  return (
    <li
      ref={setDragRef}
      // dragAttributes first, explicit a11y роли переопределяют
      // role="button" от dnd-kit draggable.
      {...dragAttributes}
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isActive}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      className="relative"
    >
      {/* Top-edge drop-strip: insertion-line при hover. 6px достаточно
          чтобы попасть курсором не попадая в основную row. */}
      <div
        ref={beforeDrop.setNodeRef}
        className={cn(
          "h-1.5 -mb-1.5 rounded relative z-10",
          hoveredZone === "before" && "bg-transparent",
        )}
      >
        {hoveredZone === "before" && (
          <div
            className="absolute left-0 right-2 top-1/2 -translate-y-1/2 h-[2px] bg-brand rounded"
            style={{ marginLeft: `${depth * 14 + 10}px` }}
          />
        )}
      </div>

      {/* Center drop-zone: при hover подсвечиваем row → стать child'ом */}
      <div
        ref={childDrop.setNodeRef}
        className={cn(
          "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
          "text-sidebar-foreground hover:bg-sidebar-accent",
          isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
          hoveredZone === "child" &&
            "bg-brand/15 ring-1 ring-brand/40 ring-inset",
        )}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
      >
        {/* Drag-handle ::: появляется на hover. Activator-ref +
            listeners — это «триггер» drag'а для всего li (drag-ref на
            li через setDragRef выше). */}
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label="Перетащить страницу"
          {...dragListeners}
          className="flex size-4 shrink-0 items-center justify-center
                     opacity-0 group-hover:opacity-60 hover:!opacity-100
                     cursor-grab active:cursor-grabbing
                     text-muted-foreground"
        >
          <GripVertical className="size-3.5" />
        </button>

        {/* Иконка/chevron — занимают одну и ту же позицию.
            Notion-style: иконка по умолчанию, chevron на hover. */}
        <span className="relative size-5 shrink-0 inline-flex items-center justify-center">
          <KbPageIcon
            icon={node.icon}
            color={node.icon_color}
            size={14}
            className={cn(
              "transition-opacity",
              hasChildren && "group-hover:opacity-0",
            )}
          />
          {hasChildren && (
            <button
              type="button"
              onClick={toggle}
              aria-label={isOpen ? "Свернуть" : "Развернуть"}
              className="absolute inset-0 flex items-center justify-center rounded
                         opacity-0 group-hover:opacity-100
                         text-muted-foreground hover:bg-sidebar-accent/60"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  isOpen && "rotate-90",
                )}
              />
            </button>
          )}
        </span>

        {/* Title (link). Lock-icon показываем при заблокированной
            странице — Sprint D Phase 3, чтобы admin'у было видно из
            дерева, какие страницы «закреплены как готовые». */}
        <Link
          href={`/knowledge/${node.slug}`}
          className="flex-1 truncate inline-flex items-center gap-1.5 min-w-0"
          title={node.is_locked ? `${node.title} (заблокирована)` : node.title}
        >
          <span className="truncate">{node.title || "Без названия"}</span>
          {node.is_locked && (
            <Lock
              className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
              aria-label="Страница заблокирована"
            />
          )}
        </Link>

        {/* Hover-only "+" to add a child. */}
        <IconTooltip label="Добавить подстраницу" side="right">
          <button
            type="button"
            onClick={onCreateChild}
            disabled={creating}
            aria-label="Добавить подстраницу"
            className="opacity-0 group-hover:opacity-100 flex size-6 shrink-0 items-center
                       justify-center rounded text-muted-foreground
                       hover:bg-sidebar-accent/60 disabled:opacity-50"
          >
            <Plus className="size-3.5" />
          </button>
        </IconTooltip>
      </div>

      {/* Bottom-edge drop-strip — insertion-line под item'ом */}
      <div
        ref={afterDrop.setNodeRef}
        className={cn(
          "h-1.5 -mt-1.5 rounded relative z-10",
          hoveredZone === "after" && "bg-transparent",
        )}
      >
        {hoveredZone === "after" && (
          <div
            className="absolute left-0 right-2 top-1/2 -translate-y-1/2 h-[2px] bg-brand rounded"
            style={{ marginLeft: `${depth * 14 + 10}px` }}
          />
        )}
      </div>

      {hasChildren && isOpen && (
        <ul className="flex flex-col gap-0.5" role="group">
          {node.children.map((child) => (
            <KbTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              activeSlug={activeSlug}
              blockedTargets={blockedTargets}
              overTarget={overTarget}
              isDraggingAny={isDraggingAny}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Walk the tree to find the path to the active slug; return ancestor IDs. */
function expandAncestors(nodes: KbTreeNode[], activeSlug?: string): Set<string> {
  const acc = new Set<string>();
  if (!activeSlug) return acc;
  const find = (list: KbTreeNode[], chain: string[]): boolean => {
    for (const n of list) {
      if (n.slug === activeSlug) {
        for (const id of chain) acc.add(id);
        return true;
      }
      if (n.children.length > 0 && find(n.children, [...chain, n.id])) {
        return true;
      }
    }
    return false;
  };
  find(nodes, []);
  return acc;
}

// ─── DnD helpers ──────────────────────────────────────────────────────

type ParentChain = {
  /** ID родителя, или null для root-уровня. */
  parentId: string | null;
  /** Массив siblings (children этого родителя), куда входит target. */
  siblings: KbTreeNode[];
};

/** Найти родителя узла + массив siblings. Для root-уровня parentId = null,
 *  siblings = top-level nodes. */
function findParentChain(
  nodes: KbTreeNode[],
  targetId: string,
): ParentChain | null {
  // Сначала проверим root-уровень.
  if (nodes.some((n) => n.id === targetId)) {
    return { parentId: null, siblings: nodes };
  }
  // Иначе рекурсивно ищем в детях.
  const walk = (list: KbTreeNode[]): ParentChain | null => {
    for (const n of list) {
      if (n.children.some((c) => c.id === targetId)) {
        return { parentId: n.id, siblings: n.children };
      }
      if (n.children.length > 0) {
        const found = walk(n.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes);
}

/** Возвращает новое дерево, в котором у узла с id === parentId children
 *  заменены на reordered. Для parentId === null заменяется top-level. */
function applyReorderToParent(
  nodes: KbTreeNode[],
  parentId: string | null,
  reordered: KbTreeNode[],
): KbTreeNode[] {
  if (parentId === null) return reordered;
  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, children: reordered };
    if (n.children.length > 0) {
      return { ...n, children: applyReorderToParent(n.children, parentId, reordered) };
    }
    return n;
  });
}

/** Найти узел в tree по id (DFS). null если не найден. */
function findNodeById(nodes: KbTreeNode[], id: string): KbTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children.length > 0) {
      const found = findNodeById(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Все id этого узла + рекурсивно всех его потомков. С `includeSelf=true`
 *  включает сам узел (обычно нужно для blockedTargets — drop на себя
 *  тоже бессмысленен). */
function collectDescendantIds(node: KbTreeNode, includeSelf: boolean): Set<string> {
  const acc = new Set<string>();
  if (includeSelf) acc.add(node.id);
  const walk = (list: KbTreeNode[]) => {
    for (const n of list) {
      acc.add(n.id);
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(node.children);
  return acc;
}

/** Optimistic apply move: убрать draggedId из старого parent'а и
 *  поставить newSiblings (включая draggedNode на новой позиции) под
 *  newParentId.
 *
 *  Возвращает новое immutable-дерево. */
function applyMoveToTree(
  nodes: KbTreeNode[],
  draggedId: string,
  newParentId: string | null,
  newSiblings: KbTreeNode[],
): KbTreeNode[] {
  // Step 1: removed dragged-node из старого места (везде кроме нового
  // parent'а — там он будет переустановлен через newSiblings).
  const removed = removeNodeById(nodes, draggedId);
  // Step 2: заменить children у newParentId на newSiblings (или
  // top-level если newParentId === null).
  return applyReorderToParent(removed, newParentId, newSiblings);
}

function removeNodeById(nodes: KbTreeNode[], id: string): KbTreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) =>
      n.children.length > 0
        ? { ...n, children: removeNodeById(n.children, id) }
        : n,
    );
}
