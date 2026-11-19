import { test } from "node:test";
import assert from "node:assert/strict";

import { socialLink } from "./social-link.ts";

test("полная ссылка Instagram с трекингом → @ник, переход по исходной ссылке", () => {
  const raw =
    "https://www.instagram.com/ggggeraaaa?igsh=MXhpMm5oc254eGo0cQ%3D%3D&utm_source=qr";
  assert.deepEqual(socialLink("instagram", raw), {
    label: "@ggggeraaaa",
    href: raw,
  });
});

test("голый ник Telegram → @ник и ссылка t.me", () => {
  assert.deepEqual(socialLink("telegram", "gggggeraaa"), {
    label: "@gggggeraaa",
    href: "https://t.me/gggggeraaa",
  });
  assert.deepEqual(socialLink("telegram", "@user_1"), {
    label: "@user_1",
    href: "https://t.me/user_1",
  });
});

test("VK без собаки, ссылка без схемы распознаётся", () => {
  assert.deepEqual(socialLink("vk", "vk.com/id12345"), {
    label: "id12345",
    href: "https://vk.com/id12345",
  });
});

test("чужой домен — подпись доменом, без ника", () => {
  assert.deepEqual(socialLink("instagram", "https://linktr.ee/someone"), {
    label: "linktr.ee",
    href: "https://linktr.ee/someone",
  });
});

test("не ссылка и не ник — показываем как есть, без перехода", () => {
  assert.deepEqual(socialLink("instagram", "нет инсты"), {
    label: "нет инсты",
    href: null,
  });
  assert.equal(socialLink("instagram", "javascript:alert(1)").href, null);
});
