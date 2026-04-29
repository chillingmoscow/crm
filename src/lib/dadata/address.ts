// DaData address suggestions for live autocomplete inputs.
//
// Used from /api/dadata/address (server route). The client sends a
// query string ("Москва, тверская 1") and gets back ranked suggestions
// with the canonical full address.

import { dadataPost } from "./client";

interface DadataAddressData {
  postal_code?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  street?: string | null;
  house?: string | null;
  flat?: string | null;
}

interface DadataAddressSuggestion {
  value?: string;
  unrestricted_value?: string;
  data?: DadataAddressData;
}

interface DadataAddressResponse {
  suggestions?: DadataAddressSuggestion[];
}

export interface AddressSuggestion {
  value: string;
  unrestricted: string;
  postalCode: string | null;
  region: string | null;
  city: string | null;
  street: string | null;
  house: string | null;
  flat: string | null;
}

/**
 * Get up to `count` address suggestions for a free-form `query`.
 * Empty / very short queries return an empty list without hitting DaData.
 */
export async function suggestAddresses(
  query: string,
  count = 7
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const res = await dadataPost<DadataAddressResponse>(
    "/suggest/address",
    { query: trimmed, count }
  );

  return (res.suggestions ?? [])
    .filter((s) => !!s.value)
    .map((s) => ({
      value:       s.value!,
      unrestricted: s.unrestricted_value ?? s.value!,
      postalCode: s.data?.postal_code ?? null,
      region:     s.data?.region ?? null,
      city:       s.data?.city ?? null,
      street:     s.data?.street ?? null,
      house:      s.data?.house ?? null,
      flat:       s.data?.flat ?? null,
    }));
}
