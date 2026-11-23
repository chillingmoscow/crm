import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateOrdersDetailed, normalizeDetail, type Order, type OrderDetail } from "./calculate.ts";
import type { SalesSettings } from "./types.ts";

const settings = {
  tip_products: {},
  deposit_products: {},
  parking_product_ids: [],
} as unknown as SalesSettings;

const order = (id: number, payer: number | null, extra: Partial<Order> = {}): Order => ({
  id,
  payer_id: payer,
  gross: 1000,
  returned: false,
  deleted: false,
  status: "closed",
  ...extra,
});
const detail = (id: number, amount = 1000): OrderDetail => ({
  id,
  returned: false,
  deleted: false,
  service: 0,
  lines: [{ product_id: 1, amount, quantity: 1 }],
});

test("гостевые чеки — действующие чеки без Staff", () => {
  const orders = [order(1, null), order(2, 7), order(3, null), order(4, null, { status: "cancelled" })];
  const details = [detail(1), detail(2), detail(3), detail(4)];
  const { metrics, guestChecks } = calculateOrdersDetailed(orders, details, [7], settings);
  assert.equal(metrics.checks, 3);
  assert.equal(guestChecks, 2);
  assert.equal(metrics.turnover, 2000);
  assert.equal(metrics.staff_checks, 1000);
});

const rawDetail = (product: Record<string, unknown>) => ({
  id: 9,
  orderItemList: [{ product, totalPrice: 100, amount: 1 }],
});

test("normalizeDetail: вид строки — блюдо по классу Dish", () => {
  const d = normalizeDetail(
    rawDetail({ id: 5, className: "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish" }),
    9,
  );
  assert.equal(d.lines[0].kind, "dish");
});

test("normalizeDetail: вид строки — модификатор по классу Modifier", () => {
  const d = normalizeDetail(
    rawDetail({ id: 5, className: "ru.edgex.quickresto.modules.warehouse.nomenclature.mods.Modifier" }),
    9,
  );
  assert.equal(d.lines[0].kind, "modifier");
});

test("normalizeDetail: вид строки — любой другой класс это other", () => {
  const d = normalizeDetail(
    rawDetail({ id: 5, className: "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct" }),
    9,
  );
  assert.equal(d.lines[0].kind, "other");
});

test("normalizeDetail: без класса поля kind нет", () => {
  const d = normalizeDetail(rawDetail({ id: 5 }), 9);
  assert.equal("kind" in d.lines[0], false);
});

test("normalizeDetail: пустой класс не даёт вида", () => {
  const d = normalizeDetail(rawDetail({ id: 5, className: "" }), 9);
  assert.equal("kind" in d.lines[0], false);
});
