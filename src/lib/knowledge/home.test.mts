import test from "node:test";
import assert from "node:assert/strict";

import { kbHomeSections } from "./home.ts";

type Node = Parameters<typeof kbHomeSections>[0][number];

const node = (id: string, children: Node[] = []): Node => ({
  id,
  parent_id: null,
  title: `Страница ${id}`,
  icon: "book",
  icon_color: "blue",
  slug: `s-${id}`,
  position: 0,
  has_children: children.length > 0,
  is_locked: false,
  children,
});

test("kbHomeSections: разделы — страницы верхнего уровня с числом всех вложенных", () => {
  const tree = [node("a", [node("a1", [node("a11")]), node("a2")]), node("b")];
  assert.deepEqual(kbHomeSections(tree), [
    { id: "a", slug: "s-a", title: "Страница a", icon: "book", iconColor: "blue", pageCount: 3 },
    { id: "b", slug: "s-b", title: "Страница b", icon: "book", iconColor: "blue", pageCount: 0 },
  ]);
});

test("kbHomeSections: пустое дерево — пусто", () => {
  assert.deepEqual(kbHomeSections([]), []);
});
