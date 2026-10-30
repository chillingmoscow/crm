import { test } from "node:test";
import assert from "node:assert/strict";
import { runProvisionStep, type ProvisionStep } from "./provision-state.ts";
test("a timed-out creation is reconciled without another POST", async () => {
  const ledger: Record<string, ProvisionStep> = {};
  let posts = 0;
  const args = {
    ledger,
    key: "guest",
    save: async () => {},
    create: async () => {
      posts++;
      throw new Error("connection lost after commit");
    },
    recover: async () => ({ id: 42 }),
  };
  await assert.rejects(runProvisionStep(args));
  assert.equal(ledger.guest.state, "started");
  assert.equal(await runProvisionStep(args), 42);
  assert.equal(await runProvisionStep(args), 42);
  assert.equal(posts, 1);
});
test("an ambiguous result blocks automatic creation", async () => {
  const ledger: Record<string, ProvisionStep> = {
    employee: { state: "started", pin: "1234" },
  };
  let posts = 0;
  await assert.rejects(
    runProvisionStep({
      ledger,
      key: "employee",
      save: async () => {},
      create: async () => {
        posts++;
        return { id: 4 };
      },
      recover: async () => null,
    }),
    /не подтверждён/,
  );
  assert.equal(posts, 0);
  assert.equal(ledger.employee.pin, "1234");
});
test("failure to persist the intent cannot initiate an external write", async () => {
  let posts = 0;
  await assert.rejects(
    runProvisionStep({
      ledger: {},
      key: "bonus",
      save: async () => {
        throw new Error("database unavailable");
      },
      create: async () => {
        posts++;
        return { id: 8 };
      },
      recover: async () => null,
    }),
  );
  assert.equal(posts, 0);
});
test("a prepared PIN survives into the completed employee step", async () => {
  const ledger: Record<string, ProvisionStep> = {
    employee: { state: "prepared", pin: "9834" },
  };
  let durable: ProvisionStep | undefined;
  const id = await runProvisionStep({
    ledger,
    key: "employee",
    save: async () => {
      durable = structuredClone(ledger.employee);
    },
    create: async () => {
      assert.equal(durable?.state, "started");
      assert.equal(durable?.pin, "9834");
      return { id: 9 };
    },
    recover: async () => null,
  });
  assert.equal(id, 9);
  assert.deepEqual(durable, { state: "done", pin: "9834", id: 9 });
});
