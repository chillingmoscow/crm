import type { OfficialExpected } from "./types";

/** Строка ответа `payroll_official_expected`: numeric из PostgREST может прийти строкой. */
export type OfficialExpectedRow = Omit<OfficialExpected, "gross"> & {
  gross: number | string | null;
};

/**
 * Приводит строки RPC к `OfficialExpected`: `gross` — числом (null остаётся null);
 * для карточки одного сотрудника оставляет только его строки.
 */
export function normalizeOfficialExpected(
  rows: OfficialExpectedRow[] | null | undefined,
  employeeId?: string | null,
): OfficialExpected[] {
  return (rows ?? [])
    .filter((r) => employeeId === undefined || employeeId === null || r.employee_id === employeeId)
    .map((r) => ({ ...r, gross: r.gross === null || r.gross === undefined ? null : Number(r.gross) }));
}
