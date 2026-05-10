import test from "node:test";
import assert from "node:assert/strict";

import type { KbProperty } from "../../types/knowledge.ts";

import type { KbCollectionField } from "./collection.ts";
import {
  formatPropertyValue,
  sortDirectionLabel,
} from "./collection-format.ts";

function makeProperty<T extends KbProperty["type"]>(
  type: T,
  patch: Partial<Extract<KbProperty, { type: T }>>,
): Extract<KbProperty, { type: T }> {
  return {
    id: `p_${type}`,
    name: type,
    type,
    ...patch,
  } as Extract<KbProperty, { type: T }>;
}

// ─────────────────────────── formatPropertyValue ─────────────────────────────

test("formatPropertyValue: text trims whitespace", () => {
  const prop = makeProperty("text", { value: "  hello  " });
  assert.equal(formatPropertyValue(prop), "hello");
});

test("formatPropertyValue: url trims whitespace", () => {
  const prop = makeProperty("url", { value: "  https://example.com  " });
  assert.equal(formatPropertyValue(prop), "https://example.com");
});

test("formatPropertyValue: number renders raw value or empty for null", () => {
  assert.equal(formatPropertyValue(makeProperty("number", { value: 42 })), "42");
  assert.equal(formatPropertyValue(makeProperty("number", { value: 0 })), "0");
  assert.equal(formatPropertyValue(makeProperty("number", { value: null })), "");
});

test("formatPropertyValue: number with rating variant renders value/max", () => {
  const prop = makeProperty("number", {
    value: 4,
    displayVariant: "rating",
    max: 10,
  });
  assert.equal(formatPropertyValue(prop), "4/10");
});

test("formatPropertyValue: number with rating variant and no max defaults to 5", () => {
  const prop = makeProperty("number", { value: 3, displayVariant: "rating" });
  assert.equal(formatPropertyValue(prop), "3/5");
});

test("formatPropertyValue: number with rating variant + null value returns empty", () => {
  const prop = makeProperty("number", {
    value: null,
    displayVariant: "rating",
  });
  assert.equal(formatPropertyValue(prop), "");
});

test("formatPropertyValue: date returns ISO string or empty for null", () => {
  assert.equal(
    formatPropertyValue(makeProperty("date", { value: "2025-01-01" })),
    "2025-01-01",
  );
  assert.equal(formatPropertyValue(makeProperty("date", { value: null })), "");
});

test("formatPropertyValue: checkbox returns Russian Да/Нет", () => {
  assert.equal(
    formatPropertyValue(makeProperty("checkbox", { value: true })),
    "Да",
  );
  assert.equal(
    formatPropertyValue(makeProperty("checkbox", { value: false })),
    "Нет",
  );
});

test("formatPropertyValue: select returns value or empty for null", () => {
  assert.equal(
    formatPropertyValue(
      makeProperty("select", { value: "Done", options: ["Done"] }),
    ),
    "Done",
  );
  assert.equal(
    formatPropertyValue(makeProperty("select", { value: null, options: [] })),
    "",
  );
});

test("formatPropertyValue: multi-select joins with comma+space", () => {
  assert.equal(
    formatPropertyValue(
      makeProperty("multi-select", {
        value: ["Alpha", "Beta", "Gamma"],
        options: ["Alpha", "Beta", "Gamma"],
      }),
    ),
    "Alpha, Beta, Gamma",
  );
  assert.equal(
    formatPropertyValue(
      makeProperty("multi-select", { value: [], options: [] }),
    ),
    "",
  );
});

test("formatPropertyValue: rating renders value/max with default 5", () => {
  assert.equal(formatPropertyValue(makeProperty("rating", { value: 3 })), "3/5");
  assert.equal(
    formatPropertyValue(makeProperty("rating", { value: 7, max: 10 })),
    "7/10",
  );
  assert.equal(formatPropertyValue(makeProperty("rating", { value: null })), "");
});

// ─────────────────────────── sortDirectionLabel ──────────────────────────────

function field(
  id: string,
  type: KbCollectionField["type"],
): KbCollectionField {
  return { id, name: id, type };
}

test("sortDirectionLabel: number/rating use по возрастанию/убыванию", () => {
  for (const type of ["number", "rating"] as const) {
    assert.equal(sortDirectionLabel(field("x", type), "asc"), "по возрастанию");
    assert.equal(sortDirectionLabel(field("x", type), "desc"), "по убыванию");
  }
});

test("sortDirectionLabel: date uses ранние/поздние", () => {
  assert.equal(sortDirectionLabel(field("d", "date"), "asc"), "сначала ранние");
  assert.equal(
    sortDirectionLabel(field("d", "date"), "desc"),
    "сначала поздние",
  );
});

test("sortDirectionLabel: checkbox uses выключенные/включённые", () => {
  assert.equal(
    sortDirectionLabel(field("c", "checkbox"), "asc"),
    "выключенные выше",
  );
  assert.equal(
    sortDirectionLabel(field("c", "checkbox"), "desc"),
    "включённые выше",
  );
});

test("sortDirectionLabel: text/url/select/multi-select default to А → Я / Я → А", () => {
  for (const type of ["text", "url", "select", "multi-select"] as const) {
    assert.equal(sortDirectionLabel(field("x", type), "asc"), "А → Я");
    assert.equal(sortDirectionLabel(field("x", type), "desc"), "Я → А");
  }
});
