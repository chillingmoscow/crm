// DaData "party" lookup: resolve a Russian legal entity by its INN.
//
// Used from /api/dadata/party (server route) when the user types an INN
// into the legal-entity / counterparty form. The hit returns enough
// data to pre-fill name, legal_form, OGRN, KPP, addresses, and director.

import { dadataPost } from "./client";

// ─── DaData response shape (subset we actually use) ──────────────────────────

interface DadataPartyName {
  full_with_opf?: string;     // "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ХОРОШЕЕ""
  short_with_opf?: string;    // "ООО "ХОРОШЕЕ""
  full?: string;
  short?: string;
}

interface DadataPartyOpf {
  type?: "LEGAL" | "INDIVIDUAL";
  code?: string;
  full?: string;
  short?: string;             // "ООО" / "ИП" / "АО" / "ПАО" / ...
}

interface DadataPartyAddress {
  value?: string;
  unrestricted_value?: string;
}

interface DadataPartyManager {
  name?: string;
  post?: string;              // "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР"
}

export interface DadataPartyData {
  inn?: string;
  kpp?: string;
  ogrn?: string;
  okpo?: string;
  okved?: string;
  name?: DadataPartyName;
  opf?: DadataPartyOpf;
  address?: DadataPartyAddress;
  state?: { status?: "ACTIVE" | "LIQUIDATING" | "LIQUIDATED" | "BANKRUPT" | "REORGANIZING" };
  management?: DadataPartyManager;
  founders?: unknown[];
}

interface DadataPartySuggestion {
  value?: string;
  unrestricted_value?: string;
  data?: DadataPartyData;
}

interface DadataPartyResponse {
  suggestions?: DadataPartySuggestion[];
}

// ─── Mapped result for our domain ────────────────────────────────────────────

export type LegalForm = "IP" | "OOO" | "AO" | "PAO" | "NKO" | "OTHER";

export interface ResolvedParty {
  /** Display name preferring short form (e.g. `ООО "Хорошее"` / `ИП Иванов И.И.`). */
  name: string;
  /** Short OPF without the legal-form prefix when possible. */
  shortName: string | null;
  legalForm: LegalForm;
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  okpo: string | null;
  okved: string | null;
  legalAddress: string | null;
  directorName: string | null;
  directorPosition: string | null;
  /** True if DaData reports the entity as ACTIVE in the registry. */
  isActive: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapLegalForm(opf: DadataPartyOpf | undefined): LegalForm {
  const short = (opf?.short ?? "").toUpperCase();
  if (short === "ИП") return "IP";
  if (short === "ООО") return "OOO";
  if (short === "ПАО") return "PAO";
  if (short === "АО" || short === "ЗАО" || short === "ОАО") return "AO";
  if (short === "АНО" || short === "НКО" || short === "ФОНД") return "NKO";
  return "OTHER";
}

function pickName(party: DadataPartyData): string {
  return (
    party.name?.short_with_opf ??
    party.name?.full_with_opf ??
    party.name?.short ??
    party.name?.full ??
    "(имя не определено)"
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up a Russian legal entity by INN. Returns null if DaData returned
 * no suggestions for the given INN.
 *
 * Accepts a 10-digit INN (legal entities) or 12-digit INN (sole proprietors).
 */
export async function findPartyByInn(inn: string): Promise<ResolvedParty | null> {
  const cleaned = inn.replace(/\D/g, "");
  if (cleaned.length !== 10 && cleaned.length !== 12) {
    return null;
  }

  const res = await dadataPost<DadataPartyResponse>(
    "/findById/party",
    { query: cleaned, count: 1 }
  );

  const first = res.suggestions?.[0]?.data;
  if (!first || !first.inn) return null;

  return {
    name:             pickName(first),
    shortName:        first.name?.short ?? null,
    legalForm:        mapLegalForm(first.opf),
    inn:              first.inn,
    kpp:              first.kpp ?? null,
    ogrn:             first.ogrn ?? null,
    okpo:             first.okpo ?? null,
    okved:            first.okved ?? null,
    legalAddress:     first.address?.unrestricted_value ?? first.address?.value ?? null,
    directorName:     first.management?.name ?? null,
    directorPosition: first.management?.post ?? null,
    isActive:         first.state?.status === "ACTIVE",
  };
}
