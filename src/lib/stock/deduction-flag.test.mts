import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOPOST_ENV, isDeductionAutopostEnabled, whenAutopostEnabled } from "./deduction-flag.ts";

test("флаг не задан - автопостановка выключена, ничего не вызывается и ничего не пишется", async () => {
  let called = 0;
  const out = await whenAutopostEnabled({}, async () => {
    called++;
    return "wrote";
  });
  assert.equal(out, null);
  assert.equal(called, 0, "пересчёт не должен даже начинаться");
});

test("любое значение, кроме 1, - выключено", async () => {
  for (const v of ["", "0", "true", "yes", "on", " 1", "1 ", "2"]) {
    let called = 0;
    const out = await whenAutopostEnabled({ [AUTOPOST_ENV]: v }, async () => {
      called++;
      return "wrote";
    });
    assert.equal(out, null, `значение ${JSON.stringify(v)}`);
    assert.equal(called, 0, `значение ${JSON.stringify(v)}`);
  }
  assert.equal(isDeductionAutopostEnabled({ [AUTOPOST_ENV]: undefined }), false);
});

test("INVENTORY_DEDUCTION_AUTOPOST=1 включает и возвращает результат пересчёта", async () => {
  assert.equal(AUTOPOST_ENV, "INVENTORY_DEDUCTION_AUTOPOST");
  assert.equal(await whenAutopostEnabled({ [AUTOPOST_ENV]: "1" }, async () => "ok"), "ok");
});
