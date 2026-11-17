import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  { ignores: ["_legacy_from_finance/**", "_legacy_from_crm2/**", "crm2/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Подсказки — только в стиле приложения: data-tip (GlobalTooltip) или
    // <Tooltip>/<IconTooltip>. Нативный title показывает системную
    // подсказку ОС. См. docs/design-system.md § «Подсказки».
    rules: {
      "react/forbid-dom-props": [
        "error",
        {
          forbid: [
            {
              propName: "title",
              disallowedFor: ["span", "div", "button", "a", "p", "time", "td", "th", "li", "label", "img", "section", "h1", "h2", "h3", "h4"],
              message: "Используйте data-tip (GlobalTooltip) или <Tooltip> вместо title — системные подсказки не в стиле приложения.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
