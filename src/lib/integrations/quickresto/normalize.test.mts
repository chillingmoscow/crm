import assert from "node:assert/strict";
import test from "node:test";

import { isQuickRestoClass } from "./normalize.ts";

const MODS = "ru.edgex.quickresto.modules.warehouse.nomenclature.mods";

test("isQuickRestoClass узнаёт модификатор и группу модификаторов", () => {
  assert.equal(isQuickRestoClass({ className: `${MODS}.Modifier` }, "Modifier"), true);
  assert.equal(isQuickRestoClass({ className: `${MODS}.ModifierGroup` }, "ModifierGroup"), true);
});

test("isQuickRestoClass не путает модификатор с группой и блюдом", () => {
  assert.equal(isQuickRestoClass({ className: `${MODS}.ModifierGroup` }, "Modifier"), false);
  assert.equal(isQuickRestoClass({ className: `${MODS}.Modifier` }, "ModifierGroup"), false);
  assert.equal(
    isQuickRestoClass(
      { className: "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish" },
      "Modifier",
    ),
    false,
  );
});
