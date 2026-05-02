"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, FileText, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createKbPage } from "@/lib/knowledge/pages";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { KbTreeNode } from "@/types/knowledge";

interface KbTreeNavProps {
  nodes: KbTreeNode[];
}

/**
 * KB tree navigator. Notion-style nested page list with:
 *  ─ chevron expand/collapse for nodes with children
 *  ─ active state when the URL slug matches
 *  ─ "+" button on hover to create a child page
 *
 * Expansion state lives in the parent so toggles use functional
 * setState (no stale closures). Ancestors of the active page are
 * auto-added to the expanded set whenever activeSlug changes — the
 * tree component does NOT remount on slug navigation (it lives in
 * the layout), so we can't rely on initial state alone.
 */
export function KbTreeNav({ nodes }: KbTreeNavProps) {
  const params = useParams<{ slug?: string }>();
  const activeSlug = params?.slug;

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

  return (
    <div className="flex flex-col gap-1 p-3">
      <KbTreeHeader />
      {nodes.length === 0 ? (
        <KbTreeEmpty />
      ) : (
        <ul className="flex flex-col gap-px" role="tree">
          {nodes.map((node) => (
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
      )}
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
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        title="Новая страница"
        onClick={onCreateRoot}
        disabled={creating}
      >
        <Plus className="size-3.5" />
      </Button>
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
    // Auto-expand the parent so the new child is visible after navigation.
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
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isActive}
    >
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1 py-1 text-sm",
          "hover:bg-sidebar-accent",
          isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {/* Chevron / spacer */}
        {hasChildren ? (
          <button
            type="button"
            onClick={toggle}
            className="flex size-5 items-center justify-center rounded
                       text-muted-foreground hover:bg-sidebar-accent/60"
            aria-label={isOpen ? "Свернуть" : "Развернуть"}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform",
                isOpen && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        {/* Icon */}
        <span className="flex size-5 shrink-0 items-center justify-center text-base leading-none">
          {node.icon ?? <FileText className="size-3.5 text-muted-foreground" />}
        </span>

        {/* Title (link) */}
        <Link
          href={`/knowledge/${node.slug}`}
          className="flex-1 truncate"
          title={node.title}
        >
          {node.title || "Без названия"}
        </Link>

        {/* Hover-only "+" to add a child */}
        <button
          type="button"
          onClick={onCreateChild}
          disabled={creating}
          title="Добавить подстраницу"
          className="opacity-0 group-hover:opacity-100 flex size-5 items-center
                     justify-center rounded text-muted-foreground
                     hover:bg-sidebar-accent/60 disabled:opacity-50"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {hasChildren && isOpen && (
        <ul className="flex flex-col gap-px" role="group">
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
