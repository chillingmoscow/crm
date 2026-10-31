import test from "node:test";
import assert from "node:assert/strict";
import { telegramDestination } from "./telegram-destination.ts";
test("applications and hiring keep separate destinations", () => {
  const organization = { default_chat_id: "team", candidate_chat_id: "recruiters" };
  assert.equal(telegramDestination("notify", organization, "old-chat"), "recruiters");
  assert.equal(telegramDestination("hired", organization, "old-chat"), "team");
});
test("clearing an override switches to the organization chat", () => {
  assert.equal(telegramDestination("notify", { default_chat_id: "team", candidate_chat_id: null }, "old-chat"), "team");
});
test("legacy settings work until the organization bot is configured", () => {
  assert.equal(telegramDestination("notify", null, "legacy"), "legacy");
  assert.equal(telegramDestination("hired", null, "legacy"), "legacy");
});
