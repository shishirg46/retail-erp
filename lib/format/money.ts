// Money formatting (D11, plan §6). The wire carries rupees (number) and the
// domain operates on whole paisa; the UI only ever *renders* values it
// received from the API, so these formatters are pure presentation and never
// do business math (the backend stays authoritative, D22.2).

import { CURRENCY_LOCALE, CURRENCY_SYMBOL } from "../constants";

// South Asian lakh/crore grouping ("12,340" / "1,23,456") — the shop's rupee
// convention (ne-NP, Latin digits).
const numberFormatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
  numberingSystem: "latn",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Rupees on the wire (number from an API payload) -> "रू 12,340.50" (plan §6).
export function formatRupees(rupees: number): string {
  return `${CURRENCY_SYMBOL} ${numberFormatter.format(rupees)}`;
}

// Whole paisa (domain value) -> "रू 12,340.50". Only for values that went
// through the paisa path (e.g. constants); most UI inputs are wire rupees.
export function formatRupeesFromPaisa(paisa: number): string {
  return formatRupees(paisa / 100);
}

// Signed balance rendering: negative means prepaid/credit-in-favor (D4).
// "रू -120.00" keeps the rupee sign + sign color semantics from plan §6.
export function formatSignedRupees(rupees: number): string {
  return rupees < 0 ? `${CURRENCY_SYMBOL} -${numberFormatter.format(Math.abs(rupees))}` : formatRupees(rupees);
}

// Compact money for dense list rows: "रू 12.3k" / "रू 1.5L" / "रू 2.1Cr".
export function formatRupeesCompact(rupees: number): string {
  const abs = Math.abs(rupees);
  const prefix = rupees < 0 ? `${CURRENCY_SYMBOL} -` : `${CURRENCY_SYMBOL} `;
  const one = new Intl.NumberFormat(CURRENCY_LOCALE, {
    numberingSystem: "latn",
    maximumFractionDigits: 1,
  });
  if (abs >= 10_000_000) return `${prefix}${one.format(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${prefix}${one.format(abs / 100_000)}L`;
  if (abs >= 1_000) return `${prefix}${one.format(abs / 1_000)}k`;
  return formatRupees(rupees);
}
