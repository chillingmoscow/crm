import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommentLink } from "./page-comment-copy-link.ts";

test("buildCommentLink appends comment hash to the page URL", () => {
  assert.equal(
    buildCommentLink("https://app.example.com/knowledge/onboarding", "c123"),
    "https://app.example.com/knowledge/onboarding#comment-c123",
  );
});

test("buildCommentLink strips an existing hash before appending", () => {
  assert.equal(
    buildCommentLink(
      "https://app.example.com/knowledge/onboarding#comment-old",
      "c999",
    ),
    "https://app.example.com/knowledge/onboarding#comment-c999",
  );
});

test("buildCommentLink strips query string", () => {
  assert.equal(
    buildCommentLink(
      "https://app.example.com/knowledge/onboarding?x=1",
      "c1",
    ),
    "https://app.example.com/knowledge/onboarding#comment-c1",
  );
});
