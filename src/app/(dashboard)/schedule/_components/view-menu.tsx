"use client";
import { ArrowUpDown, Eye } from "lucide-react";
import { TEMPLATE_SORTS, TEMPLATE_SORT_LABELS, type TemplateSort } from "@/lib/schedule/template-order";
import { ToolbarChoiceMenu } from "./toolbar-choice-menu";

export type ScheduleView = "week" | "templates" | "list";

/** Иконка-кнопка в тулбаре расписания: выбор раскладки. */
export function ViewMenu({
  value,
  onChange,
  canPlan,
}: {
  value: ScheduleView;
  onChange: (view: ScheduleView) => void;
  canPlan: boolean;
}) {
  const views: { value: ScheduleView; label: string }[] = [
    { value: "week", label: "По сотрудникам" },
    ...(canPlan ? [{ value: "templates" as const, label: "По шаблонам" }] : []),
    { value: "list", label: "Список" },
  ];
  return <ToolbarChoiceMenu icon={<Eye />} label="Вид" options={views} value={value} onChange={onChange} />;
}

/** Порядок строк в виде «По шаблонам» (и на картинке расписания). */
export function TemplateSortMenu({
  value,
  onChange,
}: {
  value: TemplateSort;
  onChange: (sort: TemplateSort) => void;
}) {
  return (
    <ToolbarChoiceMenu
      icon={<ArrowUpDown />}
      label="Сортировка"
      options={TEMPLATE_SORTS.map((sort) => ({ value: sort, label: TEMPLATE_SORT_LABELS[sort] }))}
      value={value}
      onChange={onChange}
    />
  );
}
