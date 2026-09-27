/**
 * Money is carried everywhere as an integer number of minor units (paise for INR), so no
 * floating-point rounding ever touches a balance. These helpers convert for people: the API
 * uses them in notification and audit texts, the phone on screen and in forms.
 */

/** Digits after the decimal point for an ISO 4217 currency (2 when unknown). */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Indian digit grouping (₹10,00,000) for rupees, international grouping otherwise. */
const localeFor = (currency: string): string =>
  currency === 'INR' ? 'en-IN' : 'en';

/**
 * "₹2,00,000" for 20000000 paise; fractions are shown only when there are any
 * ("₹1,250.50").
 */
export function formatMoney(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  const major = minor / 10 ** digits;
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(whole ? 0 : digits)}`;
  }
}

/**
 * Parses what a person typed ("2,00,000", "1250.5") into minor units, or undefined when it
 * is not a valid non-negative amount with at most the currency's decimals.
 */
export function parseMoney(text: string, currency: string): number | undefined {
  const digits = minorDigits(currency);
  const cleaned = text.replace(/[\s,]/g, '');
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(cleaned)) {
    return undefined;
  }
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const minor =
    Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : undefined;
}
