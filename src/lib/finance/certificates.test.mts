import { test } from "node:test";
import assert from "node:assert/strict";
import { CERTIFICATE_KINDS, certificateKindLabel, certificateStatus } from "./certificates.ts";

const TODAY = "2026-11-25";

test("certificateStatus: бессрочный", () => {
  assert.deepEqual(certificateStatus(null, TODAY), { tone: "none", label: "Бессрочный", daysLeft: null });
});
test("certificateStatus: просрочен", () => {
  assert.deepEqual(certificateStatus("2026-11-24", TODAY), { tone: "expired", label: "Просрочен", daysLeft: -1 });
});
test("certificateStatus: сегодня", () => {
  assert.deepEqual(certificateStatus("2026-11-25", TODAY), { tone: "expiring", label: "Истекает сегодня", daysLeft: 0 });
});
test("certificateStatus: в пределах 30 дней", () => {
  assert.deepEqual(certificateStatus("2026-12-02", TODAY), { tone: "expiring", label: "Истекает через 7 дн.", daysLeft: 7 });
  assert.equal(certificateStatus("2026-12-25", TODAY).tone, "expiring");
});
test("certificateStatus: больше 30 дней — действует", () => {
  assert.deepEqual(certificateStatus("2026-12-26", TODAY), { tone: "ok", label: "Действует", daysLeft: 31 });
});
test("виды и подписи", () => {
  assert.deepEqual(
    CERTIFICATE_KINDS.map((k) => k.value),
    ["conformity_certificate", "conformity_declaration", "alcohol_license", "other"],
  );
  assert.equal(certificateKindLabel("alcohol_license"), "Лицензия на алкоголь");
  assert.equal(certificateKindLabel("???"), "Документ");
});
