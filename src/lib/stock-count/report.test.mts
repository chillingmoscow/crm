import test from "node:test";
import assert from "node:assert/strict";

import { buildWeighingCaption, sendWeighingReport } from "./report.ts";

const lines = [
  { title: "Стандарт", kg: 52.418, deltaKg: -0.215, deltaSum: -1455 },
  { title: "Премиум", kg: 8.912, deltaKg: 0.04, deltaSum: 572 },
  { title: "Парфюм", kg: 0.259, deltaKg: 0, deltaSum: 0 },
];

test("buildWeighingCaption: формат подписи", () => {
  const caption = buildWeighingCaption({
    documentNumber: "СВ512",
    employeeName: "Сергей Попов",
    lines,
    url: "https://sheerly.app/documents/inventory/1",
  });
  assert.equal(
    caption,
    [
      "📊 <b>Взвешивание табака СВ512</b>",
      "Сотрудник: Сергей Попов",
      "Стандарт: 52,418 кг (−0,215 кг · −1 455 ₽)",
      "Премиум: 8,912 кг (+0,040 кг · +572 ₽)",
      "Парфюм: 0,259 кг (0,000 кг · 0 ₽)",
      '<a href="https://sheerly.app/documents/inventory/1">Акт в Sheerly</a>',
    ].join("\n"),
  );
});

test("buildWeighingCaption: экранирует HTML, без дельты — только вес", () => {
  const caption = buildWeighingCaption({
    documentNumber: "A<1>",
    employeeName: "Tom & <b>Jerry</b>",
    lines: [{ title: "Стандарт", kg: 1, deltaKg: null, deltaSum: null }],
    url: "https://x.y/z",
  });
  assert.match(caption, /Взвешивание табака A&lt;1&gt;/);
  assert.match(caption, /Сотрудник: Tom &amp; &lt;b&gt;Jerry&lt;\/b&gt;/);
  assert.match(caption, /\nСтандарт: 1,000 кг\n/);
});

function fakeBot() {
  const calls: string[] = [];
  const bot = {
    sendDocument: async () => {
      calls.push("document");
      return { ok: true };
    },
    sendMessage: async () => {
      calls.push("message");
      return { ok: true };
    },
  };
  return { bot: bot as never, calls };
}

test("sendWeighingReport: PDF скачан — уходит документом", async () => {
  const { bot, calls } = fakeBot();
  const result = await sendWeighingReport({
    bot,
    chatId: "1",
    download: async () => new Blob(["%PDF"]),
    filename: "a.pdf",
    caption: "c",
    sleep: async () => {},
  });
  assert.equal(result.sent, "document");
  assert.deepEqual(calls, ["document"]);
});

test("sendWeighingReport: 3 неудачи — сообщение, пауза дважды", async () => {
  const { bot, calls } = fakeBot();
  let sleeps = 0;
  let downloads = 0;
  const result = await sendWeighingReport({
    bot,
    chatId: "1",
    download: async () => {
      downloads += 1;
      throw new Error("нет");
    },
    filename: "a.pdf",
    caption: "c",
    sleep: async () => {
      sleeps += 1;
    },
  });
  assert.equal(result.sent, "message");
  assert.equal(downloads, 3);
  assert.equal(sleeps, 2);
  assert.deepEqual(calls, ["message"]);
});
