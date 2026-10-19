// Barcode normalisation. A 12-digit UPC-A and its 13-digit EAN form with a leading zero are the same
// product, so every UPC-A/UPC-E/EAN-13 is stored as 13 digits. EAN-8 is its own namespace and stays 8.

/** GS1 check digit for the digits before it. */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  return checkDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Expand an 8-digit UPC-E (number system 0 or 1) to its 12-digit UPC-A. */
export function upcEToUpcA(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const ns = upce[0];
  const d = upce.slice(1, 7);
  const check = upce[7];
  const last = d[5];
  let body: string;
  if (last <= '2') body = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  else if (last === '3') body = d.slice(0, 3) + '00000' + d.slice(3, 5);
  else if (last === '4') body = d.slice(0, 4) + '00000' + d[4];
  else body = d.slice(0, 5) + '0000' + last;
  return ns + body + check;
}

export type BarcodeFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | string;

/**
 * Normalise a scanned or typed barcode. Returns null for anything that isn't a retail GTIN.
 * The format hint matters only for 8-digit codes, which are EAN-8 unless the scanner says UPC-E.
 */
export function normalizeBarcode(raw: string, format?: BarcodeFormat): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 8) {
    if (format === 'upc_e') {
      const a = upcEToUpcA(digits);
      return a ? '0' + a : null;
    }
    return digits;
  }
  if (digits.length === 6 || digits.length === 7) {
    // UPC-E without number system and/or check digit, as sometimes typed.
    const body = digits.length === 6 ? '0' + digits : digits;
    const guess = upcEToUpcA(body + '0');
    if (!guess) return null;
    const a = guess.slice(0, 11) + checkDigit(guess.slice(0, 11));
    return '0' + a;
  }
  if (digits.length === 12) return '0' + digits;
  if (digits.length === 13) return digits;
  if (digits.length === 14) return digits.startsWith('0') ? digits.slice(1) : digits;
  return null;
}

/** All the forms a normalised code might have been stored under elsewhere (for Open Food Facts lookups). */
export function barcodeVariants(normalised: string): string[] {
  const out = new Set([normalised]);
  if (normalised.length === 13 && normalised.startsWith('0')) out.add(normalised.slice(1));
  return [...out];
}
