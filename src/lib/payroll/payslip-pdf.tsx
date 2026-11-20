// PDF layout of the monthly pay statement. Loaded on demand from the browser:
// the renderer is heavy and only needed when someone downloads a statement.
import { Document, Font, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { Payslip, PayslipEntry, PayslipShift } from "./payslip";

const C = { text: "#1c1917", muted: "#a8a29e", line: "#d6d3d1", band: "#f5f5f4", zebra: "#fafaf9", accent: "#1570EF" };

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
  page: { fontFamily: "Inter", fontSize: 8.5, color: C.text, paddingTop: 40, paddingBottom: 48, paddingHorizontal: 40 },
  muted: { color: C.muted },
  r: { textAlign: "right" },
  header: { flexDirection: "row", justifyContent: "space-between" },
  month: { fontSize: 9, color: C.accent, fontWeight: 600 },
  name: { fontSize: 20, fontWeight: 600, marginTop: 3 },
  total: { fontSize: 24, fontWeight: 600, marginTop: 2 },
  chain: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 18, marginBottom: 22, backgroundColor: C.band, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  op: { fontSize: 12, color: C.muted, marginHorizontal: 6 },
  chainValue: { fontSize: 10.5, fontWeight: 600 },
  chainLabel: { fontSize: 7, color: C.muted },
  warn: { borderWidth: 1, borderColor: "#f59e0b", backgroundColor: "#fffbeb", borderRadius: 6, padding: 8, marginTop: 14, fontSize: 8 },
  th: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: C.line, paddingBottom: 4, fontSize: 7.5, color: C.muted },
  tr: { flexDirection: "row", paddingVertical: 4.5 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.8, borderTopColor: C.line, paddingTop: 5 },
  columns: { flexDirection: "row", marginTop: 20, gap: 24 },
  colTitle: { fontWeight: 600, marginBottom: 5, paddingBottom: 4, borderBottomWidth: 0.8, borderBottomColor: C.line },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: C.muted },
});

const money = (n: number | null, signed = false) => {
  if (n === null) return "нет данных";
  const abs = Math.abs(n),
    frac = Math.abs(abs - Math.round(abs)) >= 0.005;
  const text = abs
    .toLocaleString("ru-RU", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: frac ? 2 : 0 })
    .replace(/ | /g, " ");
  return `${n < 0 ? "−" : signed && n > 0 ? "+" : ""}${text} ₽`;
};
/** Rounded plain number for the formula band and the table cells. */
const plain = (n: number | null) =>
  n === null ? "—" : Math.round(n).toLocaleString("ru-RU").replace(/ | /g, " ");
const rate = (r: number) => `${String(r).replace(".", ",")}%`;
const dayMonth = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const weekday = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" });
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

type Link = { label: string; value: number; op: "+" | "−" | "" };

/** The month as one sum: what was earned, what was carried and paid, what is left. */
function formula(p: Payslip): Link[] {
  const links: Link[] = [];
  if (p.shifts.length && p.shiftTotal !== null) links.push({ label: "смены", value: p.shiftTotal, op: "" });
  if (p.additions.length) links.push({ label: "премии", value: p.additionsTotal, op: links.length ? "+" : "" });
  if (p.deductions.length) links.push({ label: "удержания", value: -p.deductionsTotal, op: "−" });
  if (p.opening) links.push({ label: p.opening < 0 ? "переплата" : "долг", value: Math.abs(p.opening), op: p.opening < 0 ? "−" : "+" });
  if (p.transferredOut) links.push({ label: "перенесено", value: p.transferredOut, op: "−" });
  if (p.paid) links.push({ label: "выплачено", value: p.paid, op: "−" });
  return links;
}

function ShiftTable({ shifts, total }: { shifts: PayslipShift[]; total: number | null }) {
  const other = shifts.some((x) => (x.other ?? 0) !== 0);
  const cols = other
    ? { date: "13%", base: "11%", percent: "28%", extra: "22%", other: "10%", total: "16%" }
    : { date: "14%", base: "12%", percent: "30%", extra: "24%", other: "0%", total: "20%" };
  return (
    <View>
      <View style={s.th} fixed>
        <Text style={{ width: cols.date }}>Смена</Text>
        <Text style={[{ width: cols.base }, s.r]}>Выход</Text>
        <Text style={[{ width: cols.percent }, s.r]}>Процент от кассы</Text>
        <Text style={[{ width: cols.extra }, s.r]}>Допродажи</Text>
        {other && <Text style={[{ width: cols.other }, s.r]}>Стаж и др.</Text>}
        <Text style={[{ width: cols.total }, s.r]}>Итого</Text>
      </View>
      {shifts.map((x, i) => (
        <View key={i} style={[s.tr, { backgroundColor: i % 2 ? C.zebra : "#fff" }]} wrap={false}>
          <Text style={{ width: cols.date, paddingLeft: 2 }}>
            {dayMonth(x.date)} <Text style={s.muted}>{weekday(x.date)}</Text>
          </Text>
          <Text style={[{ width: cols.base }, s.r]}>{plain(x.base)}</Text>
          <Text style={[{ width: cols.percent }, s.r]}>
            {x.sales !== null && x.rate !== null && (
              <Text style={s.muted}>{`${plain(x.sales)} × ${rate(x.rate)} = `}</Text>
            )}
            {plain(x.percent)}
          </Text>
          <Text style={[{ width: cols.extra }, s.r]}>
            {x.sharedWith > 1 && (x.extra ?? 0) !== 0 && (
              <Text style={s.muted}>
                {x.extraPool !== null ? `${plain(x.extraPool)} ÷ ${x.sharedWith} = ` : `÷ ${x.sharedWith} = `}
              </Text>
            )}
            {plain(x.extra)}
          </Text>
          {other && <Text style={[{ width: cols.other }, s.r]}>{x.other ? plain(x.other) : "—"}</Text>}
          <Text style={[{ width: cols.total, fontWeight: 600, paddingRight: 2 }, s.r]}>{money(x.total)}</Text>
        </View>
      ))}
      <View style={s.totalRow} wrap={false}>
        <Text style={s.muted}>
          {shifts.length} {plural(shifts.length, ["смена", "смены", "смен"])}
        </Text>
        <Text style={{ fontWeight: 600 }}>{money(total)}</Text>
      </View>
    </View>
  );
}

function EntryColumn({ title, entries, signed }: { title: string; entries: PayslipEntry[]; signed: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.colTitle}>{title}</Text>
      {entries.length ? (
        entries.map((e, i) => (
          <View key={i} style={{ marginBottom: 5 }} wrap={false}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={s.muted}>{dayMonth(e.date)}</Text>
              <Text style={{ fontWeight: 500 }}>{money(e.amount, signed)}</Text>
            </View>
            {e.title && <Text style={{ marginTop: 1 }}>{e.title}</Text>}
          </View>
        ))
      ) : (
        <Text style={s.muted}>нет</Text>
      )}
    </View>
  );
}

export function PayslipDocument({ p, generatedAt }: { p: Payslip; generatedAt: Date }) {
  const overpaid = p.remainingKnown && p.remaining < 0;
  const resultLabel = overpaid ? "переплата" : "к выплате";
  const links = formula(p);
  return (
    <Document title={`Расчётный лист — ${p.employee} — ${monthTitle(p.month)}`} author="Sheerly" language="ru">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.month}>{monthTitle(p.month)}</Text>
            <Text style={s.name}>{p.employee}</Text>
            <Text style={[s.muted, { marginTop: 2 }]}>{p.role}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.muted}>{resultLabel}</Text>
            <Text style={s.total}>
              {p.remainingKnown && p.shiftTotal !== null ? money(Math.abs(p.remaining)) : "уточняется"}
            </Text>
          </View>
        </View>

        {p.issues.length > 0 && (
          <View style={s.warn}>
            <Text>Расчёт за месяц ещё не окончательный: {p.issues.slice(0, 3).join("; ")}.</Text>
          </View>
        )}

        {/* An unknown shift total must not turn into 0 inside the sum. */}
        {p.remainingKnown && (p.shiftTotal !== null || !p.shifts.length) ? (
          <View style={s.chain} wrap={false}>
            {links.map((link, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center" }}>
                {link.op && <Text style={s.op}>{link.op}</Text>}
                <View style={{ alignItems: "center" }}>
                  <Text style={s.chainValue}>{plain(link.value)}</Text>
                  <Text style={s.chainLabel}>{link.label}</Text>
                </View>
              </View>
            ))}
            <Text style={s.op}>=</Text>
            <View style={{ alignItems: "center" }}>
              <Text style={[s.chainValue, { color: C.accent }]}>{plain(Math.abs(p.remaining))}</Text>
              <Text style={s.chainLabel}>{resultLabel}</Text>
            </View>
          </View>
        ) : (
          <View style={s.chain}>
            <Text>
              {p.remainingKnown
                ? `По части смен ещё нет данных, поэтому итог за смены не посчитан. Выплачено ${money(p.paid)}.`
                : `Начислено за месяц ${money(p.earned)}, выплачено ${money(p.paid)}. Остаток с прошлых периодов ещё сверяется, поэтому сумма к выплате появится позже.`}
            </Text>
          </View>
        )}

        {p.shifts.length > 0 && <ShiftTable shifts={p.shifts} total={p.shiftTotal} />}

        <View style={s.columns} wrap={false}>
          <EntryColumn title="Премии и надбавки" entries={p.additions} signed />
          <EntryColumn title="Удержания" entries={p.deductions} signed />
          <EntryColumn
            title="Выплаты"
            entries={p.payments.map((x) => ({ date: x.date, title: "", amount: x.amount }))}
            signed={false}
          />
        </View>

        <View style={s.footer} fixed>
          <Text>
            {p.tips > 0 ? `Чаевые ${money(p.tips)} получены на сменах и в расчёт не входят. ` : ""}
            Сформирован {generatedAt.toLocaleDateString("ru-RU")}
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
