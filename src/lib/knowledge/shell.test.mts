import test from "node:test";
import assert from "node:assert/strict";

import {
  isKnowledgePath,
  kbCrumbs,
  kbTreeServiceItems,
  resolveMenuOpen,
} from "./shell.ts";

test("isKnowledgePath: база знаний и её страницы, но не похожие пути", () => {
  assert.equal(isKnowledgePath("/knowledge"), true);
  assert.equal(isKnowledgePath("/knowledge/abc"), true);
  assert.equal(isKnowledgePath("/knowledge-x"), false);
  assert.equal(isKnowledgePath("/people/staff"), false);
  assert.equal(isKnowledgePath(null), false);
});

test("resolveMenuOpen: вне базы — настройка приложения, в базе — своя", () => {
  assert.equal(resolveMenuOpen({ onKnowledge: false, appOpen: true, kbOpen: false }), true);
  assert.equal(resolveMenuOpen({ onKnowledge: true, appOpen: true, kbOpen: false }), false);
  assert.equal(resolveMenuOpen({ onKnowledge: true, appOpen: false, kbOpen: true }), true);
  assert.equal(resolveMenuOpen({ onKnowledge: false, appOpen: false, kbOpen: true }), false);
});

test("kbCrumbs: База знаний / предки / текущая без ссылки", () => {
  assert.deepEqual(
    kbCrumbs([
      { slug: "a", title: "Бар" },
      { slug: "b", title: "Открытие бара" },
    ]),
    [
      { label: "База знаний", href: "/knowledge" },
      { label: "Бар", href: "/knowledge/a" },
      { label: "Открытие бара" },
    ],
  );
});

test("kbCrumbs: глубокая вложенность сокращается до первого предка, «…» и родителя", () => {
  const chain = [1, 2, 3, 4, 5, 6].map((n) => ({ slug: `s${n}`, title: `t${n}` }));
  assert.deepEqual(kbCrumbs(chain), [
    { label: "База знаний", href: "/knowledge" },
    { label: "t1", href: "/knowledge/s1" },
    { label: "…" },
    { label: "t5", href: "/knowledge/s5" },
    { label: "t6" },
  ]);
});

test("kbCrumbs: три предка показываются целиком", () => {
  const chain = [1, 2, 3, 4].map((n) => ({ slug: `s${n}`, title: `t${n}` }));
  assert.equal(kbCrumbs(chain).length, 5);
});

test("kbCrumbs: пустые названия — «Без названия»", () => {
  assert.deepEqual(kbCrumbs([{ slug: "a", title: null }]), [
    { label: "База знаний", href: "/knowledge" },
    { label: "Без названия" },
  ]);
  assert.deepEqual(kbCrumbs([{ slug: "p", title: "  " }, { slug: "a", title: "X" }])[1], {
    label: "Без названия",
    href: "/knowledge/p",
  });
});

test("kbTreeServiceItems: у сотрудника без прав и обязательного чтения — только «Главная»", () => {
  const items = kbTreeServiceItems({
    canViewOverview: false,
    canSeeTrash: false,
    requiredTotal: 0,
    requiredUnread: 0,
  });
  assert.deepEqual(items.top.map((i) => i.key), ["home"]);
  assert.deepEqual(items.bottom, []);
});

test("kbTreeServiceItems: менеджер видит обзор, к прочтению со счётчиком и корзину", () => {
  const items = kbTreeServiceItems({
    canViewOverview: true,
    canSeeTrash: true,
    requiredTotal: 5,
    requiredUnread: 2,
  });
  assert.deepEqual(items.top.map((i) => i.key), ["home", "overview", "to-read"]);
  assert.deepEqual(items.top[0], { key: "home", label: "Главная", href: "/knowledge" });
  assert.equal(items.top[1].href, "/knowledge/dashboard");
  assert.deepEqual(items.top[2], {
    key: "to-read",
    label: "К прочтению",
    href: "/knowledge#to-read",
    count: 2,
  });
  assert.deepEqual(items.bottom, [{ key: "trash", label: "Корзина", href: "/knowledge/trash" }]);
});

test("kbTreeServiceItems: всё прочитано — пункт без счётчика", () => {
  const items = kbTreeServiceItems({
    canViewOverview: false,
    canSeeTrash: false,
    requiredTotal: 5,
    requiredUnread: 0,
  });
  const toRead = items.top.find((i) => i.key === "to-read");
  assert.ok(toRead);
  assert.equal("count" in toRead, false);
});
