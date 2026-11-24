import test from "node:test";
import assert from "node:assert/strict";

const { UPSELL_DEPARTMENT_DELETE_BLOCK, isUpsellDepartmentFkError } = await import("./department-delete.ts");

const upsellFk = {
  code: "23503",
  message:
    'update or delete on table "departments" violates foreign key constraint "sales_upsell_departments_department_id_fkey" on table "sales_upsell_departments"',
};

test("удаление подразделения из допродаж узнаётся по имени ограничения", () => {
  assert.equal(isUpsellDepartmentFkError(upsellFk), true);
});

test("ограничение допродаж находится и в details", () => {
  assert.equal(
    isUpsellDepartmentFkError({ code: "23503", message: "violates foreign key constraint", details: 'Key (id)=(x) is still referenced from table "sales_upsell_departments" via sales_upsell_departments_department_id_fkey' }),
    true,
  );
});

test("чужое ограничение (акты списания) не выдаётся за допродажи", () => {
  assert.equal(
    isUpsellDepartmentFkError({
      code: "23503",
      message:
        'update or delete on table "departments" violates foreign key constraint "writeoff_pool_assignments_department_id_fkey" on table "writeoff_pool_assignments"',
    }),
    false,
  );
});

test("другая ошибка с тем же именем в тексте, но не 23503, не считается", () => {
  assert.equal(isUpsellDepartmentFkError({ code: "42501", message: upsellFk.message }), false);
  assert.equal(isUpsellDepartmentFkError(null), false);
});

test("сообщение — по-русски и объясняет причину", () => {
  assert.equal(UPSELL_DEPARTMENT_DELETE_BLOCK, "Подразделение участвует в допродажах: по его правилам считается зарплата. Удалить его нельзя.");
});
