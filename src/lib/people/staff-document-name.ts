/** ASCII storage keys keep Russian labels without relying on URL escaping. */
export function encodeStaffDocumentName(name: string): string {
  return "hex-" + Array.from(new TextEncoder().encode(name), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function decodeStaffDocumentName(name: string): string {
  if (/^hex-(?:[0-9a-f]{2})+$/i.test(name)) {
    const bytes = name.slice(4).match(/../g)!.map((b) => parseInt(b, 16));
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  }
  return decodeURIComponent(name);
}
