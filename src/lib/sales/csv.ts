export function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-[\d.,]+$/.test(s)))
    s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
