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
import { ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { createKbPage, reorderKbSiblings } from "@/lib/knowledge/pages";
import { KbSearchTrigger } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
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
}

/**
 * KB tree navigator. Notion-style nested page list with:
 *  ─ chevron expand/collapse for nodes with children
 *  ─ active state when the URL slug matches
 *  ─ "+" button on hover to create a child page
 *  ─ drag-handle (::: на hover) для reorder siblings внутри одного
 *    родителя. Cross-parent move (перенос ветки) — следующая итерация
 *    Sprint A. Для MVP — только sibling reorder через @dnd-kit/sortable.
 *
 * Expansion state lives in the parent so toggles use functional
 * setState (no stale closures). Ancestors of the active page are
 * auto-added to the expanded set whenever activeSlug changes.
 */
export function KbTreeNav({ nodes, favorites = [], canSeeTrash = false }: KbTreeNavProps) {
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Найдём родителей обоих item'ов в текущем tree.
      const activeParent = findParentChain(localNodes, activeId);
      const overParent = findParentChain(localNodes, overId);
      if (!activeParent || !overParent) return;

      // MVP — только sibling reorder. Cross-parent drop игнорируем
      // (родителей разные → toast hint и выходим).
      if (activeParent.parentId !== overParent.parentId) {
        toast.info("Перенос между ветками — в следующей версии");
        return;
      }

      const siblings = activeParent.siblings;
      const oldIndex = siblings.findIndex((s) => s.id === activeId);
      const newIndex = siblings.findIndex((s) => s.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(siblings, oldIndex, newIndex);
      // Optimistic.
      setLocalNodes((prev) =>
        applyReorderToParent(prev, activeParent.parentId, reordered),
      );

      // Атомарный re-numbering ВСЕХ siblings (а не только moved).
      // Без этого после reload tree.ts (sort by (position, title))
      // ловил tie на одинаковых position и резолвил алфавитно,
      // теряя drag-order. См. миграцию 067.
      const orderedIds = reordered.map((n) => n.id);
      void reorderKbSiblings(activeParent.parentId, orderedIds).then(
        ({ error }) => {
          if (error) {
            toast.error(`Не удалось переместить: ${error}`);
            setLocalNodes(nodes); // revert
          }
        },
      );
    },
    [localNodes, nodes],
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full">
        <div className="flex flex-col gap-2 p-3 pb-2">
          <div className="px-1 pt-1 shrink-0">
            <KbSearchTrigger />
          </div>
          {favorites.length > 0 && (
            <KbFavoritesSection favorites={favorites} activeSlug={activeSlug} />
          )}
          <KbTreeHeader />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          {localNodes.length === 0 ? (
            <KbTreeEmpty />
          ) : (
            <SortableContext
              items={localNodes.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              {/* gap-0.5 совпадает с дашборд-сайдбаром (см. AppSidebar →
                  sub-menu контейнер `flex flex-col gap-0.5`). */}
              <ul className="flex flex-col gap-0.5" role="tree">
                {localNodes.map((node) => (
                  <KbTreeItem
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    activeSlug={activeSlug}
                  />
                ))}
              </ul>
            </SortableContext>
          )}
        </div>

        {canSeeTrash && (
          <div className="mt-auto h-16 px-2 border-t border-sidebar-border flex items-center">
            <Link
              href="/knowledge/trash"
              className="flex w-full items-center gap-2 rounded-lg p-2
                         text-sm text-muted-foreground
                         hover:bg-sidebar-accent hover:text-foreground transition-colors"
            >
              <Trash2 className="size-4 shrink-0" />
              Корзина
            </Link>
          </div>
        )}
      </div>
    </DndContext>
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

function KbTreeHeader() {
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
}

function KbTreeItem({ node, depth, expanded, setExpanded, activeSlug }: KbTreeItemProps) {
  const router = useRouter();
  const isActive = activeSlug === node.slug;
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const [creating, setCreating] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id });

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      // Чтобы dragging-row отображался поверх соседей и не мерцал.
      zIndex: isDragging ? 10 : undefined,
      opacity: isDragging ? 0.6 : undefined,
    }),
    [transform, transition, isDragging],
  );

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
      ref={setNodeRef}
      style={style}
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isActive}
    >
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
          "text-sidebar-foreground hover:bg-sidebar-accent",
          isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
      >
        {/* Drag-handle ::: появляется на hover, занимает узкую колонку
            слева от иконки. attributes/listeners — это и есть
            «активатор» drag для всего li (через setNodeRef выше). */}
        <button
          type="button"
          aria-label="Перетащить страницу"
          {...attributes}
          {...listeners}
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

        {/* Title (link) */}
        <Link
          href={`/knowledge/${node.slug}`}
          className="flex-1 truncate"
          title={node.title}
        >
          {node.title || "Без названия"}
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

      {hasChildren && isOpen && (
        <SortableContext
          items={node.children.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-0.5" role="group">
            {node.children.map((child) => (
              <KbTreeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                setExpanded={setExpanded}
                activeSlug={activeSlug}
              />
            ))}
          </ul>
        </SortableContext>
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
