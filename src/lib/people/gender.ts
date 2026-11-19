import { z } from "zod";

/**
 * Пол сотрудника (`profiles.gender`). Обязателен везде, где сотрудника
 * создают или правят его личные данные: по нему журнал событий
 * согласует глагол («изменил» / «изменила»), а автоматизации ЗП —
 * поздравления к 23 февраля и 8 марта.
 */
export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABEL: Record<Gender, string> = {
  male: "Мужской",
  female: "Женский",
};

export const GENDER_OPTIONS = GENDERS.map((value) => ({
  value,
  label: GENDER_LABEL[value],
}));

export const GENDER_REQUIRED = "Укажите пол";

export function isGender(value: unknown): value is Gender {
  return value === "male" || value === "female";
}

/** Значение для формы: пол или пустая строка «не выбран». */
export function genderFormValue(value: string | null | undefined): Gender | "" {
  return isGender(value) ? value : "";
}

/** Серверная проверка: только `male` / `female`, без пустой строки и null. */
export const genderSchema = z.enum(GENDERS, {
  errorMap: () => ({ message: GENDER_REQUIRED }),
});

/**
 * Поле формы: в форме лежит строка ("" — не выбран), отправить можно
 * только `male` / `female`.
 */
export const genderFormField = z
  .string()
  // Явный boolean, не type guard (TS 5.5 выводит его сам): тип поля в
  // форме остаётся string, иначе defaultValue ""
  // не проходит по типу.
  .refine((value: string): boolean => isGender(value), {
    message: GENDER_REQUIRED,
  });
