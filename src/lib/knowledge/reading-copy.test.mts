import test from "node:test";
import assert from "node:assert/strict";

import {
  kbRereadConfirmText as confirmRaw,
  kbStaleReadersText as staleRaw,
} from "./reading-copy.ts";

// countRu ставит неразрывный пробел между числом и словом.
const plain = (text: string) => text.replace(/\u00a0/g, " ");
const kbRereadConfirmText = (others: number, self: boolean) => plain(confirmRaw(others, self));
const kbStaleReadersText = (others: number, self: boolean) => plain(staleRaw(others, self));

test("kbRereadConfirmText: другие получат уведомление", () => {
  assert.equal(
    kbRereadConfirmText(3, false),
    "3 человека снова увидят её в «К прочтению» и получат уведомление.",
  );
  assert.equal(
    kbRereadConfirmText(1, false),
    "1 человек снова увидит её в «К прочтению» и получит уведомление.",
  );
});

test("kbRereadConfirmText: свой старый прочитанный тоже сбросится, без «0 человек»", () => {
  assert.equal(
    kbRereadConfirmText(0, true),
    "Ваше прочтение сбросится, страница снова появится у вас в «К прочтению».",
  );
  assert.equal(
    kbRereadConfirmText(2, true),
    "2 человека снова увидят её в «К прочтению» и получат уведомление. Ваше прочтение тоже сбросится.",
  );
});

test("kbStaleReadersText: кто прочитал прошлую версию", () => {
  assert.equal(kbStaleReadersText(0, true), "вы");
  assert.equal(kbStaleReadersText(2, false), "2 человека");
  assert.equal(kbStaleReadersText(1, true), "вы и ещё 1 человек");
});
