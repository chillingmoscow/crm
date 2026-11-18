// PDF layout of the monthly pay statement. Loaded on demand from the browser:
// the renderer is heavy and only needed when someone downloads a statement.
import { Document, Font, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { Payslip } from "./payslip";

const C = { text: "#0a0a0a", muted: "#6b7280", line: "#e5e7eb", soft: "#f5f6f8" };

let registered = "";
function registerFonts(base: string) {
  if (registered === base) return;
  Font.register({
    family: "Inter",
    fonts: [
      { src: `${base}/Inter-Regular.ttf` },
      { src: `${base}/Inter-Medium.ttf`, fontWeight: 500 },
      { src: `${base}/Inter-SemiBold.ttf`, fontWeight: 600 },
    ],
  });
  // Words are not split: Russian hyphenation rules are not bundled.
  Font.registerHyphenationCallback((word) => [word]);
  registered = base;
}

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, color: C.text, paddingTop: 32, paddingBottom: 44, paddingHorizontal: 40 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  eyebrow: { fontSize: 9, color: C.muted },
  title: { fontSize: 20, fontWeight: 600, marginTop: 2 },
  subtitle: { fontSize: 11, marginTop: 4 },
  summary: { flexDirection: "row", borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 12, marginBottom: 14 },
  totalBox: { width: "38%", paddingRight: 14, borderRightWidth: 1, borderRightColor: C.line, justifyContent: "center" },
  totalLabel: { fontSize: 9, color: C.muted },
  total: { fontSize: 22, fontWeight: 600, marginTop: 4 },
  totalNote: { fontSize: 8, color: C.muted, marginTop: 6, lineHeight: 1.35 },
  lines: { flex: 1, paddingLeft: 14 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  lineStrong: { fontWeight: 600, borderTopWidth: 1, borderTopColor: C.line, marginTop: 3, paddingTop: 5 },
  muted: { color: C.muted },
  section: { marginBottom: 12 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
  sectionTitle: { fontSize: 11, fontWeight: 600 },
  sectionSum: { fontSize: 10, fontWeight: 600 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 4, color: C.muted, fontSize: 8 },
  tr: { borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 3 },
  row: { flexDirection: "row" },
  basis: { fontSize: 7.5, color: C.muted, marginTop: 2, lineHeight: 1.3 },
  num: { textAlign: "right" },
  note: { fontSize: 8, color: C.muted, lineHeight: 1.4 },
  warn: { borderWidth: 1, borderColor: "#f59e0b", backgroundColor: "#fffbeb", borderRadius: 6, padding: 8, marginBottom: 14, fontSize: 8 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.muted },
});

const money = (n: number | null, signed = false) => {
  if (n === null) return "нет данных";
  const abs = Math.abs(n),
    whole = Number.isInteger(Math.round(abs * 100) / 100) || Math.abs(abs - Math.round(abs)) < 0.005;
  const text = abs
    .toLocaleString("ru-RU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })
    .replace(/ | /g, " ");
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}${text} ₽`;
};
const day = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}, ${d.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" })}`;
};
const monthTitle = (month: string) => {
  const t = new Date(`${month.slice(0, 7)}-01T12:00:00Z`)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .replace(" г.", "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const plural = (n: number, forms: [string, string, string]) => {
  const a = Math.abs(n) % 100,
    b = a % 10;
  return a > 10 && a < 20 ? forms[2] : b === 1 ? forms[0] : b > 1 && b < 5 ? forms[1] : forms[2];
};

const SHIFT_COLS: { label: string; width: string; num?: boolean }[] = [
  { label: "Дата", width: "13%" },
  { label: "Должность", width: "17%" },
  { label: "Выход", width: "11%", num: true },
  { label: "Процент", width: "12%", num: true },
  { label: "Допродажи", width: "12%", num: true },
  { label: "Стаж и др.", width: "11%", num: true },
  { label: "За смену", width: "13%", num: true },
  { label: "Чаевые", width: "11%", num: true },
];

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[s.line, strong ? s.lineStrong : {}]}>
      <Text style={strong ? {} : s.muted}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function EntryTable({ title, entries, total }: { title: string; entries: Payslip["additions"]; total: number }) {
  if (!entries.length) return null;
  return (
    <View style={s.section} wrap={false}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        <Text style={s.sectionSum}>{money(total, true)}</Text>
      </View>
      <View style={s.th}>
        <Text style={{ width: "15%" }}>Дата</Text>
        <Text style={{ width: "65%" }}>Основание</Text>
        <Text style={[{ width: "20%" }, s.num]}>Сумма</Text>
      </View>
      {entries.map((e, i) => (
        <View key={i} style={[s.tr, s.row]}>
          <Text style={{ width: "15%" }}>{day(e.date)}</Text>
          <Text style={{ width: "65%" }}>{e.title}</Text>
          <Text style={[{ width: "20%" }, s.num]}>{money(e.amount, true)}</Text>
        </View>
      ))}
    </View>
  );
}

export function PayslipDocument({ p, generatedAt }: { p: Payslip; generatedAt: Date }) {
  const owed = p.opening + p.earned - p.transferredOut;
  const overpaid = p.remainingKnown && p.remaining < 0;
  return (
    <Document title={`Расчётный лист — ${p.employee} — ${monthTitle(p.month)}`} author="Sheerly" language="ru">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>Расчётный лист</Text>
            <Text style={s.title}>{monthTitle(p.month)}</Text>
            <Text style={s.subtitle}>
              {p.employee} · {p.role}
            </Text>
          </View>
          <Text style={s.eyebrow}>Сформирован {generatedAt.toLocaleDateString("ru-RU")}</Text>
        </View>

        {p.issues.length > 0 && (
          <View style={s.warn}>
            <Text>Расчёт за месяц ещё не окончательный: {p.issues.slice(0, 3).join("; ")}.</Text>
          </View>
        )}

        <View style={s.summary} wrap={false}>
          <View style={s.totalBox}>
            <Text style={s.totalLabel}>{overpaid ? "Переплата" : "Осталось выплатить"}</Text>
            <Text style={s.total}>{p.remainingKnown ? money(Math.abs(p.remaining)) : "уточняется"}</Text>
            <Text style={s.totalNote}>
              {p.remainingKnown
                ? `Выплачено ${money(p.paid)} из ${money(owed)}`
                : "Остаток с прошлых периодов ещё сверяется"}
            </Text>
            {p.tips > 0 && (
              <Text style={s.totalNote}>
                Чаевые {money(p.tips)}
                {p.tipPaid > 0 ? `, выдано ${money(p.tipPaid)}` : ""} — отдельно от зарплаты
              </Text>
            )}
          </View>
          <View style={s.lines}>
            <Line
              label={`За смены (${p.shifts.length} ${plural(p.shifts.length, ["смена", "смены", "смен"])})`}
              value={money(p.shiftTotal)}
            />
            {p.additions.length > 0 && <Line label="Премии и надбавки" value={money(p.additionsTotal, true)} />}
            {p.deductions.length > 0 && <Line label="Удержания" value={money(p.deductionsTotal)} />}
            <Line label="Начислено за месяц" value={money(p.earned)} strong />
            {p.opening !== 0 && (
              <Line label={p.opening < 0 ? "Переплата прошлых месяцев" : "Долг с прошлых месяцев"} value={money(p.opening, true)} />
            )}
            {p.transferredOut !== 0 && <Line label="Перенесено на другой месяц" value={money(-p.transferredOut)} />}
            <Line label="Выплачено" value={money(-p.paid)} />
          </View>
        </View>

        {p.shifts.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Смены</Text>
              <Text style={s.sectionSum}>{money(p.shiftTotal)}</Text>
            </View>
            <View style={s.th} fixed>
              {SHIFT_COLS.map((col) => (
                <Text key={col.label} style={[{ width: col.width }, col.num ? s.num : {}]}>
                  {col.label}
                </Text>
              ))}
            </View>
            {p.shifts.map((shift, i) => {
              const cells = [day(shift.date), shift.role, shift.base, shift.percent, shift.extra, shift.other, shift.total, shift.tips];
              return (
                <View key={i} style={s.tr} wrap={false}>
                  <View style={s.row}>
                    {cells.map((v, j) => (
                      <Text
                        key={j}
                        style={[{ width: SHIFT_COLS[j].width }, SHIFT_COLS[j].num ? s.num : {}, j === 6 ? { fontWeight: 600 } : {}]}
                      >
                        {typeof v === "string" ? v : v === 0 && j !== 6 ? "—" : money(v)}
                      </Text>
                    ))}
                  </View>
                  {shift.basis.length > 0 && <Text style={s.basis}>{shift.basis.join("   ·   ")}</Text>}
                </View>
              );
            })}
          </View>
        )}

        <EntryTable title="Премии и надбавки" entries={p.additions} total={p.additionsTotal} />
        <EntryTable title="Удержания" entries={p.deductions} total={p.deductionsTotal} />

        {p.payments.length > 0 && (
          <View style={s.section} wrap={false}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Выплаты за этот месяц</Text>
              <Text style={s.sectionSum}>{money(p.paid)}</Text>
            </View>
            {p.payments.map((pay, i) => (
              <View key={i} style={[s.tr, s.row]}>
                <Text style={{ width: "80%" }}>{day(pay.date)}</Text>
                <Text style={[{ width: "20%" }, s.num]}>{money(pay.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.note} wrap={false}>
          За смену — выход, процент от продаж, допродажи и надбавки дня; под сменой — из чего они получились.
          Вопросы по расчёту — к управляющему.
        </Text>

        <View style={s.footer} fixed>
          <Text>
            {p.employee} · {monthTitle(p.month)}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} из ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Renders the statement to a PDF blob in the browser. */
export async function renderPayslip(p: Payslip, fontBase: string): Promise<Blob> {
  registerFonts(fontBase);
  return pdf(<PayslipDocument p={p} generatedAt={new Date()} />).toBlob();
}
