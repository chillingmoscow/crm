"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  BookCheck,
  ChevronRight,
  Home,
  LayoutGrid,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
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
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { ExpandPanel } from "@/components/shared/overview-toggle";
import { useActiveNavGlide } from "@/components/shared/nav-glide";
import { createKbPage, moveKbPageInTree } from "@/lib/knowledge/pages";
import {
  kbDropZoneDisabled,
  kbTreeServiceItems,
  type KbTreeServiceItem,
} from "@/lib/knowledge/shell";
import { KbTreeCreateMenu } from "@/app/(dashboard)/knowledge/_components/kb-tree-create-menu";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbTreeNodeMenu } from "@/app/(dashboard)/knowledge/_components/kb-tree-node-menu";
import { useKbTreeOverride } from "@/app/(dashboard)/knowledge/_components/kb-tree-overrides-store";
import { useKbPageStateOverride } from "@/app/(dashboard)/knowledge/_components/kb-page-state-overrides-store";
import type { KbFavoritePage } from "@/lib/knowledge/favorites";
import type { KbTreeNode } from "@/types/knowledge";


interface KbTreeNavProps {
  nodes: KbTreeNode[];
  /** Список favorited-страниц текущего юзера. Рендерится отдельной
   *  секцией над «Страницы». Пустой список — секция не показывается. */
  favorites?: KbFavoritePage[];
  /** Whether to show the «Корзина» link at the bottom of the tree.
   *  Driven by `kb.delete_pages` permission, gated server-side in
   *  the layout. The trash route itself also re-checks. */
  canSeeTrash?: boolean;
  /** `kb.delete_pages` — gates node-level trash action. */
  canDelete?: boolean;
  /** `kb.create_pages` — gates node-level duplicate action. */
  canDuplicate?: boolean;
  /** Видит ли пользователь «Обзор»: `kb.view_analytics`,
   *  `kb.manage_required_reading` или `org.view_audit` (страница
   *  перепроверяет сама). */
  canViewOverview?: boolean;
  /** Обязательное чтение текущего пользователя: всего страниц и
   *  непрочитанных — для пункта «К прочтению» и его счётчика. */
  readingSummary?: { total: number; unread: number };
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
 *  ─ Notion-style drag: page row itself is the drag activator. Поддерживается:
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
  canDelete = false,
  canDuplicate = false,
  canViewOverview = false,
  readingSummary = { total: 0, unread: 0 },
  canImport = false,
  canCreate = false,
  canManageTemplates = false,
}: KbTreeNavProps) {
  const params = useParams<{ slug?: string }>();
  const activeSlug = params?.slug;
  const pathname = usePathname();
  const serviceItems = kbTreeServiceItems({
    canViewOverview,
    canSeeTrash,
    requiredTotal: readingSummary.total,
    requiredUnread: readingSummary.unread,
  });
  // Подсветка активного пункта переезжает, как в меню приложения
  // (docs/motion.md, «Активный пункт меню»).
  const navRef = useRef<HTMLDivElement>(null);
  useActiveNavGlide(navRef, pathname, true, '[data-kb-active="true"]');

  // Local mirror of `nodes` для оптимистичного reorder. При успехе
  // server-data догонит. При ошибке — откатываем к props.nodes.
  const [localNodes, setLocalNodes] = useState(nodes);
  useEffect(() => setLocalNodes(nodes), [nodes]);

  const [localFavorites, setLocalFavorites] = useState(favorites);
  useEffect(() => setLocalFavorites(favorites), [favorites]);
  const favoriteIds = useMemo(
    () => new Set(localFavorites.map((favorite) => favorite.id)),
    [localFavorites],
  );
  const descendantCounts = useMemo(() => buildDescendantCountMap(localNodes), [localNodes]);

  const handleFavoriteChange = useCallback(
    (page: KbFavoritePage, favorited: boolean) => {
      setLocalFavorites((prev) => {
        if (favorited) {
          const withoutPage = prev.filter((favorite) => favorite.id !== page.id);
          return [page, ...withoutPage];
        }
        return prev.filter((favorite) => favorite.id !== page.id);
      });
    },
    [],
  );

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
      <div className="flex h-full flex-col px-3.5 pb-3">
        {/* Шапка колонки — на высоте верхней панели (68px). */}
        <div data-kb-tree-header className="flex h-[68px] shrink-0 items-center gap-2 pl-3">
          <span className="flex-1 truncate text-base font-semibold">База знаний</span>
          <KbTreeCreateMenu
            canCreate={canCreate}
            canImport={canImport}
            canManageTemplates={canManageTemplates}
          />
        </div>
        <div
          ref={navRef}
          className="relative -mx-3.5 flex-1 overflow-y-auto px-3.5"
        >
          <nav aria-label="Разделы базы знаний" className="flex flex-col gap-1">
            {serviceItems.top.map((item) => (
              <KbTreeServiceLink
                key={item.key}
                item={item}
                active={isServiceItemActive(item, pathname)}
              />
            ))}
          </nav>
          {localFavorites.length > 0 && (
            <KbFavoritesSection
              favorites={localFavorites}
              activeSlug={activeSlug}
              descendantCounts={descendantCounts}
              onFavoriteChange={handleFavoriteChange}
              canCreate={canCreate}
              canDuplicate={canDuplicate}
              canDelete={canDelete}
            />
          )}
          <div className={TREE_CAPTION}>Страницы</div>
          {localNodes.length === 0 ? (
            <KbTreeEmpty canCreate={canCreate} />
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
                  favoriteIds={favoriteIds}
                  onFavoriteChange={handleFavoriteChange}
                  canCreate={canCreate}
                  canDuplicate={canDuplicate}
                  canDelete={canDelete}
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

        {serviceItems.bottom.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-t border-sidebar-border pt-2">
            {serviceItems.bottom.map((item) => (
              <KbTreeServiceLink
                key={item.key}
                item={item}
                active={isServiceItemActive(item, pathname)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating cursor-preview под мышкой во время drag'а. */}
      <DragOverlay dropAnimation={null}>
        {draggedNode ? (
          <div
            className="flex min-h-9 max-w-[260px] items-center gap-2.5 rounded-lg border border-sidebar-border
                       bg-sidebar px-3 text-[13px] font-medium text-sidebar-foreground shadow-md"
          >
            <KbPageIcon
              icon={draggedNode.icon}
              color={draggedNode.icon_color}
              size={16}
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
          "h-10 mt-2 rounded-lg border-2 border-dashed transition-colors",
          active
            ? "border-brand bg-brand/10"
            : "border-transparent hover:border-sidebar-border",
        )}
      >
        {active && (
          <div className="h-full flex items-center justify-center text-xs font-medium text-brand">
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
  descendantCounts,
  onFavoriteChange,
  canCreate,
  canDuplicate,
  canDelete,
}: {
  favorites: KbFavoritePage[];
  activeSlug?: string;
  descendantCounts: Map<string, number>;
  onFavoriteChange: (page: KbFavoritePage, favorited: boolean) => void;
  canCreate: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();

  const createChild = async (page: KbFavoritePage) => {
    const { slug, error } = await createKbPage({ parent_id: page.id });
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать подстраницу");
      return;
    }
    router.push(`/knowledge/${slug}`);
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className={TREE_CAPTION}>Избранное</div>
      {favorites.map((p) => {
        const isActive = activeSlug === p.slug;
        return (
          <div
            key={p.id}
            className={cn(TREE_ROW, "font-medium", isActive ? TREE_ROW_ACTIVE : TREE_ROW_IDLE)}
          >
            <Link
              href={`/knowledge/${p.slug}`}
              className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch"
              data-tip={p.title}
              data-tip-overflow
            >
              <KbPageIcon icon={p.icon} color={p.icon_color} size={16} />
              <span className="truncate">{p.title || "Без названия"}</span>
            </Link>
            <span className={TREE_ROW_ACTIONS}>
            <KbTreeNodeMenu
              page={p}
              childCount={descendantCounts.get(p.id) ?? 0}
              favorited
              canCreate={canCreate}
              canDuplicate={canDuplicate}
              canDelete={canDelete}
              onCreateChild={() => void createChild(p)}
              onFavoriteChange={onFavoriteChange}
            />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function KbTreeEmpty({ canCreate }: { canCreate: boolean }) {
  return (
    <p className="px-2 py-3 text-sm text-muted-foreground">
      {canCreate ? (
        <>
          Пока нет страниц. Нажмите{" "}
          <kbd className="rounded border px-1">+</kbd> выше, чтобы создать
          первую.
        </>
      ) : (
        <>Пока нет страниц.</>
      )}
    </p>
  );
}

interface KbTreeItemProps {
  node: KbTreeNode;
  depth: number;
  /** Строка лежит внутри свёрнутой (но смонтированной) ветки — её зоны
   *  перетаскивания выключены. */
  insideCollapsed?: boolean;
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
  favoriteIds: Set<string>;
  onFavoriteChange: (page: KbFavoritePage, favorited: boolean) => void;
  canCreate: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
}

function KbTreeItem({
  node,
  depth,
  insideCollapsed = false,
  expanded,
  setExpanded,
  activeSlug,
  blockedTargets,
  overTarget,
  isDraggingAny,
  favoriteIds,
  onFavoriteChange,
  canCreate,
  canDuplicate,
  canDelete,
}: KbTreeItemProps) {
  const router = useRouter();
  // Client-side override (icon / iconColor / title) — пишется
  // KbPageEditor'ом сразу после save'а tree-relevant полей. Если есть
  // — fallback'ом перебивает server-данные node'а до next navigation
  // (когда server отдаст уже свежие). Без оверрайда юзеру пришлось бы
  // делать router.refresh() и перезагружать пол-страницы.
  const override = useKbTreeOverride(node.id);
  const displayIcon = override?.icon !== undefined ? override.icon : node.icon;
  const displayIconColor =
    override?.iconColor !== undefined ? override.iconColor : node.icon_color;
  const displayTitle = override?.title ?? node.title;
  // Lock-state используется только в title-tooltip'е (для информации
  // что страница заблокирована). Visual lock-chip в самой строке tree
  // больше не рендерим — пользователь видит lock-status уже из page-
  // header'а на самой странице, дублирующая иконка в дереве визуально
  // зашумляла.
  const stateOverride = useKbPageStateOverride(node.id);
  const displayIsLocked = stateOverride?.locked ?? node.is_locked;
  const isActive = activeSlug === node.slug;
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const [everOpened, setEverOpened] = useState(isOpen);
  useEffect(() => {
    if (isOpen) setEverOpened(true);
  }, [isOpen]);
  const [creating, setCreating] = useState(false);
  const isBlocked = blockedTargets?.has(node.id) ?? false;
  const isFavorited = favoriteIds.has(node.id);

  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: node.id });
  const {
    "aria-describedby": dragDescriptionId,
    ...stableDragAttributes
  } = dragAttributes;
  void dragDescriptionId;

  // 3 droppable strip'а: before/child/after. Disabled если этот item —
  // dragged-сам (или его потомок). Активны только во время drag'а.
  const dropDisabled = kbDropZoneDisabled({ isBlocked, isDraggingAny, insideCollapsed });
  const beforeDrop = useDroppable({
    id: makeDropId(node.id, "before"),
    disabled: dropDisabled,
  });
  const childDrop = useDroppable({
    id: makeDropId(node.id, "child"),
    disabled: dropDisabled,
  });
  const afterDrop = useDroppable({
    id: makeDropId(node.id, "after"),
    disabled: dropDisabled,
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

  const createChild = async () => {
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

  const onCreateChild = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void createChild();
  };

  const menuPage: KbFavoritePage = {
    id: node.id,
    slug: node.slug,
    title: displayTitle,
    icon: displayIcon,
    icon_color: displayIconColor,
  };

  return (
    <li
      ref={setDragRef}
      // dragAttributes first, explicit a11y роли переопределяют
      // role="button" от dnd-kit draggable.
      {...stableDragAttributes}
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
            className="absolute left-3 right-2 top-1/2 -translate-y-1/2 h-[2px] bg-brand rounded"
          />
        )}
      </div>

      {/* Center drop-zone: при hover подсвечиваем row → стать child'ом.
          Строка — в стиле пункта меню приложения: 36px, 13px, значок 16px,
          активная — синяя подложка (docs/design-system.md, «База знаний»). */}
      <div
        ref={childDrop.setNodeRef}
        {...dragListeners}
        data-kb-active={isActive ? "true" : undefined}
        className={cn(
          TREE_ROW,
          "cursor-grab active:cursor-grabbing",
          depth === 0 ? "font-medium" : "font-normal",
          isActive ? TREE_ROW_ACTIVE : TREE_ROW_IDLE,
          hoveredZone === "child" &&
            "bg-brand/15 ring-1 ring-brand/40 ring-inset",
        )}
      >
        {/* Title (link). Заблокированность — в подсказке строки. */}
        <Link
          href={`/knowledge/${node.slug}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch"
          data-tip={displayIsLocked ? `${displayTitle} (заблокирована)` : displayTitle}
          data-tip-overflow={displayIsLocked ? undefined : true}
        >
          <KbPageIcon icon={displayIcon} color={displayIconColor} size={16} />
          <span className="truncate">{displayTitle || "Без названия"}</span>
        </Link>

        {/* Действия узла занимают место только при наведении/фокусе или
            пока открыто их меню — в покое название видно целиком. */}
        <span className={TREE_ROW_ACTIONS}>
        {canCreate && (
          <IconTooltip label="Добавить подстраницу" side="right">
            <button
              type="button"
              onClick={onCreateChild}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={creating}
              aria-label="Добавить подстраницу"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0
                         transition-opacity hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50
                         group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
            >
              <Plus className="size-4" />
            </button>
          </IconTooltip>
        )}

        <KbTreeNodeMenu
          page={menuPage}
          childCount={countDescendants(node)}
          favorited={isFavorited}
          canCreate={canCreate}
          canDuplicate={canDuplicate}
          canDelete={canDelete}
          onCreateChild={createChild}
          onFavoriteChange={onFavoriteChange}
        />
        </span>

        {/* Шеврон справа, как у разделов меню; место держим и у страниц
            без подстраниц — названия в столбце не прыгают. */}
        {hasChildren ? (
          <button
            type="button"
            onClick={toggle}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={isOpen ? "Свернуть" : "Развернуть"}
            aria-expanded={isOpen}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60
                       transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronRight className={cn("motion-chevron size-4", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}
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
            className="absolute left-3 right-2 top-1/2 -translate-y-1/2 h-[2px] bg-brand rounded"
          />
        )}
      </div>

      {/* Подстраницы — под тонкой линией, как подпункты меню; раскрываются
          плавно. Монтируем ветку только после первого раскрытия: большие
          импортированные деревья не рендерятся целиком. */}
      {hasChildren && everOpened && (
        <ExpandPanel open={isOpen}>
        <ul
          className="ml-3 flex flex-col gap-0.5 border-l border-border/75 pl-2"
          role="group"
        >
          {node.children.map((child) => (
            <KbTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              insideCollapsed={insideCollapsed || !isOpen}
              expanded={expanded}
              setExpanded={setExpanded}
              activeSlug={activeSlug}
              blockedTargets={blockedTargets}
              overTarget={overTarget}
              isDraggingAny={isDraggingAny}
              favoriteIds={favoriteIds}
              onFavoriteChange={onFavoriteChange}
              canCreate={canCreate}
              canDuplicate={canDuplicate}
              canDelete={canDelete}
            />
          ))}
        </ul>
        </ExpandPanel>
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

function countDescendants(node: KbTreeNode): number {
  let count = 0;
  const walk = (list: KbTreeNode[]) => {
    for (const child of list) {
      count += 1;
      if (child.children.length > 0) walk(child.children);
    }
  };
  walk(node.children);
  return count;
}

function buildDescendantCountMap(nodes: KbTreeNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (node: KbTreeNode): number => {
    let count = 0;
    for (const child of node.children) {
      count += 1 + walk(child);
    }
    counts.set(node.id, count);
    return count;
  };
  for (const node of nodes) walk(node);
  return counts;
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

/** Подпись группы дерева — как «Рабочее пространство» в меню приложения
 *  (`.navCaption` в workspace-appearance.module.css). */
const TREE_CAPTION =
  "px-3 pb-2 pt-[18px] text-xs font-medium uppercase tracking-[0.6px] text-muted-foreground";

/** Строка страницы: 36px, 13px, отступ слева как у пунктов меню. */
const TREE_ROW =
  "group flex min-h-9 items-center gap-1 rounded-lg pl-3 pr-1 text-[13px] transition-colors";
const TREE_ROW_IDLE = "text-sidebar-foreground hover:bg-sidebar-accent";
const TREE_ROW_ACTIVE = "bg-brand/10 font-semibold text-brand";
const TREE_ROW_ACTIONS =
  "hidden shrink-0 items-center group-hover:flex group-focus-within:flex has-[[data-state=open]]:flex [@media(pointer:coarse)]:flex";

const SERVICE_ICONS: Record<KbTreeServiceItem["key"], LucideIcon> = {
  home: Home,
  overview: LayoutGrid,
  "to-read": BookCheck,
  trash: Trash2,
};

function isServiceItemActive(item: KbTreeServiceItem, pathname: string): boolean {
  switch (item.key) {
    case "home":
      return pathname === "/knowledge";
    case "overview":
      return pathname.startsWith("/knowledge/dashboard");
    case "trash":
      return pathname === "/knowledge/trash";
    default:
      return false;
  }
}

/** Служебный пункт дерева («Главная», «Обзор», «К прочтению», «Корзина») —
 *  ровно пункт меню приложения: 41px, 13px / 500, значок 17px серый,
 *  активный — синяя подложка и синий жирный текст. */
function KbTreeServiceLink({
  item,
  active,
}: {
  item: KbTreeServiceItem;
  active: boolean;
}) {
  const Icon = SERVICE_ICONS[item.key];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-kb-active={active ? "true" : undefined}
      className={cn(
        "flex min-h-[41px] items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
        active
          ? "bg-brand/10 font-semibold text-brand"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <Icon className="size-[17px] shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.count !== undefined && (
        <span
          className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
          aria-label={`Не прочитано: ${item.count}`}
        >
          {item.count}
        </span>
      )}
    </Link>
  );
}
