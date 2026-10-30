export const PUNCTUALITY_LABELS = {
  early: "Пришёл заранее", on_time: "Вовремя",
  late_warned: "Опоздал, предупредил", late: "Опоздал",
} as const;
export const SMILE_LABELS = { true: "Улыбался", occasionally: "Улыбался иногда", false: "Не улыбался" } as const;
export const APPEARANCE_OPTIONS = ["Опрятный, аккуратный", "В целом опрятный", "Замечания к опрятности", "Не удалось оценить"];
export const COMMUNICATION_OPTIONS = ["Ясно и по делу", "Вежливо, неуверенно", "Нужны уточнения", "Перебивал собеседника", "Сложно понять ответы"];
/** Keep existing free-text observations selectable without rewriting their meaning. */
export function feedbackOptions(values: readonly string[], current: string) {
  return [{ value: "", label: "Не отмечено" }, ...values.map(value => ({ value, label: value })),
    ...(current && !values.includes(current) ? [{ value: current, label: current }] : [])];
}
