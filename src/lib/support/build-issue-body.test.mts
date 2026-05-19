import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIssueBody,
  buildIssueTitle,
  issueLabels,
  type SupportContext,
} from "./build-issue-body.ts";

const ctx: SupportContext = {
  userEmail: "user@example.com",
  accountId: "acc-1",
  pageUrl: "/finance/transactions",
  userAgent: "Mozilla/5.0 (Macintosh)",
  viewport: "1440x900",
  submittedAt: "2026-05-19T10:00:00.000Z",
};

test("buildIssueTitle: prefixes category label and first line", () => {
  assert.equal(
    buildIssueTitle("bug", "Кнопка не работает\nвторая строка"),
    "[Report] Ошибка: Кнопка не работает",
  );
});

test("buildIssueTitle: truncates long first line", () => {
  const title = buildIssueTitle("idea", "x".repeat(200));
  assert.ok(title.endsWith("…"));
  assert.ok(title.length < 120);
});

test("buildIssueTitle: empty description falls back", () => {
  assert.equal(buildIssueTitle("question", "   "), "[Report] Вопрос: без описания");
});

test("issueLabels: always includes user-report + category", () => {
  assert.deepEqual(issueLabels("bug"), ["user-report", "bug"]);
});

test("buildIssueBody: includes description and context table", () => {
  const body = buildIssueBody({
    description: "Что-то сломалось",
    category: "bug",
    context: ctx,
  });
  assert.ok(body.includes("Что-то сломалось"));
  assert.ok(body.includes("| Пользователь | user@example.com |"));
  assert.ok(body.includes("| Страница | /finance/transactions |"));
  assert.ok(!body.includes("Вложение:"));
});

test("buildIssueBody: renders attachment link with ttl note", () => {
  const body = buildIssueBody({
    description: "См. скриншот",
    category: "bug",
    context: ctx,
    attachmentUrl: "https://example.com/file.png",
    attachmentName: "screen.png",
    attachmentTtlDays: 30,
  });
  assert.ok(
    body.includes("**Вложение:** [screen.png](https://example.com/file.png)"),
  );
  assert.ok(body.includes("~30 дн."));
});

test("buildIssueBody: sanitizes pipe chars in user agent", () => {
  const body = buildIssueBody({
    description: "x",
    category: "bug",
    context: { ...ctx, userAgent: "Weird|Agent\nNewline" },
  });
  assert.ok(body.includes("Weird\\|Agent Newline"));
});
