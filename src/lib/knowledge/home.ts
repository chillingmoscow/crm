import type { KbTreeNode } from "../../types/knowledge.ts";

/**
 * Главная базы знаний (спека «Главная»): плитки «Разделы» — страницы
 * верхнего уровня дерева и сколько страниц внутри каждой (все уровни).
 */
export type KbHomeSection = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  pageCount: number;
};

function descendants(node: KbTreeNode): number {
  return node.children.reduce((sum, child) => sum + 1 + descendants(child), 0);
}

export function kbHomeSections(tree: KbTreeNode[]): KbHomeSection[] {
  return tree.map((node) => ({
    id: node.id,
    slug: node.slug,
    title: node.title,
    icon: node.icon,
    iconColor: node.icon_color,
    pageCount: descendants(node),
  }));
}
