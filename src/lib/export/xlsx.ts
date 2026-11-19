// Minimal XLSX (Office Open XML) writer: just what a styled report needs —
// several sheets, a fixed set of cell styles, column widths, frozen header,
// merged title cells, autofilter, print setup and SUM formulas.
// Pure: returns the file parts; `xlsxBlob` zips them (jszip is loaded lazily).

/** Named cell styles; the order is the `cellXfs` index in styles.xml. */
export const XLSX_STYLES = [
  "text",
  "title",
  "subtitle",
  "header",
  "headerRight",
  "money",
  "int",
  "hours",
  "muted",
  "totalText",
  "totalMoney",
  "totalInt",
  "totalHours",
  "note",
  "wrap",
] as const;
export type XlsxStyle = (typeof XLSX_STYLES)[number];

export type XlsxValue = string | number | null;
export type XlsxCell =
  | XlsxValue
  | {
      v: XlsxValue;
      s?: XlsxStyle;
      /** Formula without the leading «=»; `v` is kept as the cached result. */
      f?: string;
    };

export type XlsxSheet = {
  /** Sheet tab name; trimmed to Excel's 31 characters, forbidden characters removed. */
  name: string;
  rows: XlsxCell[][];
  /** Column widths in characters, by column index. */
  widths?: number[];
  /** Row heights in points, by 0-based row index. */
  heights?: Record<number, number>;
  /** Freeze rows above `row` and columns left of `col` (0-based counts). */
  freeze?: { rows: number; cols?: number };
  /** Ranges like "A1:F1". */
  merges?: string[];
  /** Autofilter range like "A5:K20". */
  autoFilter?: string;
  /** 1-based rows repeated at the top of every printed page, e.g. [5, 5]. */
  printTitleRows?: [number, number];
  landscape?: boolean;
};

const MONEY = '#,##0.00\\ "₽";[Red]\\-#,##0.00\\ "₽"';
const INT = "#,##0";
const HOURS = "#,##0.0";

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export const cellRef = (row: number, col: number) => `${columnName(col)}${row + 1}`;

// Control characters other than tab/newline are not allowed in XML 1.0.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const escapeXml = (s: string) =>
  s
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function sheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim();
  return (clean || "Лист").slice(0, 31);
}

function cellXml(cell: XlsxCell, row: number, col: number): string {
  const { v, s, f } =
    cell !== null && typeof cell === "object" ? cell : { v: cell, s: undefined, f: undefined };
  if (v === null && !f && !s) return "";
  const style = XLSX_STYLES.indexOf(s ?? "text");
  const attrs = `r="${cellRef(row, col)}"${style > 0 ? ` s="${style}"` : ""}`;
  if (f) {
    const cached = typeof v === "number" && Number.isFinite(v) ? `<v>${v}</v>` : "";
    return `<c ${attrs}><f>${escapeXml(f)}</f>${cached}</c>`;
  }
  if (typeof v === "number") {
    return Number.isFinite(v) ? `<c ${attrs}><v>${v}</v></c>` : `<c ${attrs}/>`;
  }
  if (v === null || v === "") return `<c ${attrs}/>`;
  // Inline strings are never evaluated, so «=…» from user data stays text.
  return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
}

export function sheetXml(sheet: XlsxSheet): string {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const height = Math.max(1, sheet.rows.length);
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheetPr>${sheet.landscape ? '<pageSetUpPr fitToPage="1"/>' : ""}</sheetPr>`,
    `<dimension ref="A1:${cellRef(height - 1, width - 1)}"/>`,
  ];
  const fr = sheet.freeze?.rows ?? 0;
  const fc = sheet.freeze?.cols ?? 0;
  if (fr || fc) {
    const pane = fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight";
    parts.push(
      `<sheetViews><sheetView workbookViewId="0"><pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${cellRef(fr, fc)}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${cellRef(fr, fc)}" sqref="${cellRef(fr, fc)}"/></sheetView></sheetViews>`,
    );
  } else {
    parts.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
  }
  parts.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sheet.widths?.length) {
    parts.push(
      `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`,
    );
  }
  parts.push("<sheetData>");
  sheet.rows.forEach((row, r) => {
    const ht = sheet.heights?.[r];
    parts.push(
      `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${row
        .map((cell, c) => cellXml(cell, r, c))
        .join("")}</row>`,
    );
  });
  parts.push("</sheetData>");
  if (sheet.autoFilter) parts.push(`<autoFilter ref="${sheet.autoFilter}"/>`);
  if (sheet.merges?.length) {
    parts.push(
      `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((m) => `<mergeCell ref="${m}"/>`)
        .join("")}</mergeCells>`,
    );
  }
  parts.push(
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>',
  );
  if (sheet.landscape) {
    parts.push('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
  }
  parts.push("</worksheet>");
  return parts.join("");
}

function stylesXml(): string {
  // fonts: 0 regular, 1 bold, 2 title, 3 grey, 4 italic grey
  // fills: 0 none, 1 gray125 (required), 2 header grey
  // borders: 0 none, 1 header bottom, 2 total top
  // numFmts: 164 money, 165 int, 166 hours
  const xf = (
    numFmt: number,
    font: number,
    fill: number,
    border: number,
    align = "",
  ) =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${
      numFmt ? ' applyNumberFormat="1"' : ""
    }${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${
      align ? ` applyAlignment="1"><alignment ${align}/></xf>` : "/>"
    }`;
  const byStyle: Record<XlsxStyle, string> = {
    text: xf(0, 0, 0, 0, 'vertical="center"'),
    title: xf(0, 2, 0, 0, 'vertical="center"'),
    subtitle: xf(0, 3, 0, 0, 'vertical="center"'),
    header: xf(0, 1, 2, 1, 'vertical="center" wrapText="1"'),
    headerRight: xf(0, 1, 2, 1, 'horizontal="right" vertical="center" wrapText="1"'),
    money: xf(164, 0, 0, 0, 'vertical="center"'),
    int: xf(165, 0, 0, 0, 'vertical="center"'),
    hours: xf(166, 0, 0, 0, 'vertical="center"'),
    muted: xf(0, 3, 0, 0, 'horizontal="right" vertical="center"'),
    totalText: xf(0, 1, 0, 2, 'vertical="center"'),
    totalMoney: xf(164, 1, 0, 2, 'vertical="center"'),
    totalInt: xf(165, 1, 0, 2, 'vertical="center"'),
    totalHours: xf(166, 1, 0, 2, 'vertical="center"'),
    note: xf(0, 4, 0, 0, 'vertical="top" wrapText="1"'),
    wrap: xf(0, 0, 0, 0, 'vertical="center" wrapText="1"'),
  };
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<numFmts count="3"><numFmt numFmtId="164" formatCode="${escapeXml(MONEY)}"/><numFmt numFmtId="165" formatCode="${INT}"/><numFmt numFmtId="166" formatCode="${HOURS}"/></numFmts>`,
    '<fonts count="5">',
    '<font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="14"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>',
    '<font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>',
    '<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>',
    "</fonts>",
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill></fills>',
    '<borders count="3">',
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>',
    '<border><left/><right/><top style="thin"><color rgb="FF9CA3AF"/></top><bottom/><diagonal/></border>',
    "</borders>",
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    `<cellXfs count="${XLSX_STYLES.length}">${XLSX_STYLES.map((s) => byStyle[s]).join("")}</cellXfs>`,
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    "</styleSheet>",
  ].join("");
}

/** All parts of the .xlsx package, path → XML. */
export function xlsxParts(sheets: XlsxSheet[]): Record<string, string> {
  const names = sheets.map((s) => sheetName(s.name));
  const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;
  const definedNames = sheets.flatMap((s, i) => {
    const out: string[] = [];
    if (s.autoFilter) {
      const [a, b] = s.autoFilter.split(":");
      const abs = (ref: string) => ref.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
      out.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escapeXml(
          `${quoted(names[i])}!${abs(a)}:${abs(b ?? a)}`,
        )}</definedName>`,
      );
    }
    if (s.printTitleRows) {
      out.push(
        `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${escapeXml(
          `${quoted(names[i])}!$${s.printTitleRows[0]}:$${s.printTitleRows[1]}`,
        )}</definedName>`,
      );
    }
    return out;
  });
  const parts: Record<string, string> = {
    "[Content_Types].xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      ...sheets.map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      ),
      "</Types>",
    ].join(""),
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<bookViews><workbookView activeTab="0"/></bookViews>',
      `<sheets>${names
        .map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets>`,
      definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : "",
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>',
      "</workbook>",
    ].join(""),
    "xl/_rels/workbook.xml.rels": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ...sheets.map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      ),
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
      "</Relationships>",
    ].join(""),
    "xl/styles.xml": stylesXml(),
  };
  sheets.forEach((s, i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s);
  });
  return parts;
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Zip the parts into an .xlsx Blob. */
export async function xlsxBlob(sheets: XlsxSheet[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, xml] of Object.entries(xlsxParts(sheets))) zip.file(path, xml);
  return zip.generateAsync({
    type: "blob",
    mimeType: XLSX_MIME,
    compression: "DEFLATE",
  });
}

/** Save a Blob as a file from the browser. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
