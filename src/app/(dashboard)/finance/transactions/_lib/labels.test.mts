import test from "node:test";
import assert from "node:assert/strict";

import { canEditTransaction, type TransactionPermissions } from "./labels.ts";

const none: TransactionPermissions = {
  create: false,
  updateOwn: false,
  updateAny: false,
  delete: false,
  export: false,
  manageBankAccounts: false,
  manageCategories: false,
  manageCounterparties: false,
  viewAttachments: false,
  uploadAttachments: false,
  deleteAttachments: false,
  viewAllVenues: false,
};
const me = "user-1";
const mine = { created_by: me, deleted_at: null };
const theirs = { created_by: "user-2", deleted_at: null };

test("без прав на правку операции не меняются", () => {
  assert.equal(canEditTransaction(mine, none, me), false);
});

test("update_transaction — только свои", () => {
  const own = { ...none, updateOwn: true };
  assert.equal(canEditTransaction(mine, own, me), true);
  assert.equal(canEditTransaction(theirs, own, me), false);
  assert.equal(canEditTransaction(mine, own, null), false);
});

test("update_any_transaction — любые", () => {
  assert.equal(canEditTransaction(theirs, { ...none, updateAny: true }, me), true);
});

test("удалённую не правят даже с полными правами", () => {
  assert.equal(
    canEditTransaction({ ...mine, deleted_at: "2026-11-20T10:00:00Z" }, { ...none, updateAny: true }, me),
    false,
  );
});
