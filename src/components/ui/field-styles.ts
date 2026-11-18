/**
 * Общие классы полей формы (DS «Form States»). Одни на все поля: `Input`,
 * `Textarea`, `SelectTrigger`/`OptionSelect`, `DatePicker`, `TimePicker`,
 * `MonthPicker variant="field"`, `Combobox`.
 *
 * Держим строки здесь, чтобы фокус и ошибка не разъезжались между
 * компонентами: раньше в одной форме было четыре-пять разных обводок.
 */

/** Фокус: border swap на brand + мягкий halo, без ring-offset. */
export const fieldFocusClass =
  "focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-0";

/**
 * Ошибка: красная рамка, когда у поля `aria-invalid="true"` (его ставит
 * `Field`). Кнопки-пикеры (`DatePicker`, `TimePicker`, `MonthPicker`) роль
 * `button` с `aria-invalid` не поддерживает — им тот же признак приходит
 * как `data-invalid`, а текст ошибки озвучивается через `aria-describedby`.
 */
export const fieldInvalidClass =
  "aria-[invalid=true]:border-destructive data-[invalid=true]:border-destructive";
