import { SCALE, type Units } from './money';

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------
const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function englishBelowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${EN_ONES[hundreds]} hundred`);
  if (rest) {
    if (rest < 20) parts.push(EN_ONES[rest]);
    else parts.push(EN_TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${EN_ONES[rest % 10]}` : ''));
  }
  return parts.join(' ');
}

export function integerToEnglish(value: bigint): string {
  if (value === 0n) return 'zero';
  const groups: number[] = [];
  let n = value < 0n ? -value : value;
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    words.push(englishBelowThousand(groups[i]) + (EN_SCALES[i] ? ` ${EN_SCALES[i]}` : ''));
  }
  return words.join(' ');
}

// ---------------------------------------------------------------------------
// Arabic (masculine counted noun, e.g. دينار)
// ---------------------------------------------------------------------------
const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const AR_TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const AR_SCALES = [
  null,
  { one: 'ألف', two: 'ألفان', plural: 'آلاف', accusative: 'ألفاً' },
  { one: 'مليون', two: 'مليونان', plural: 'ملايين', accusative: 'مليوناً' },
  { one: 'مليار', two: 'ملياران', plural: 'مليارات', accusative: 'ملياراً' },
  { one: 'تريليون', two: 'تريليونان', plural: 'تريليونات', accusative: 'تريليوناً' },
];

function arabicBelowHundred(n: number): string {
  if (n <= 10) return AR_ONES[n];
  if (n === 11) return 'أحد عشر';
  if (n === 12) return 'اثنا عشر';
  if (n < 20) return `${AR_ONES[n - 10]} عشر`;
  const unit = n % 10;
  const tens = AR_TENS[Math.floor(n / 10)];
  return unit ? `${AR_ONES[unit]} و${tens}` : tens;
}

function arabicBelowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(AR_HUNDREDS[hundreds]);
  if (rest) parts.push(arabicBelowHundred(rest));
  return parts.join(' و');
}

function arabicGroup(n: number, scaleIndex: number): string {
  const scale = AR_SCALES[scaleIndex];
  if (!scale) return arabicBelowThousand(n);
  if (n === 1) return scale.one;
  if (n === 2) return scale.two;
  const rest = n % 100;
  if (n <= 10) return `${arabicBelowThousand(n)} ${scale.plural}`;
  if (rest >= 3 && rest <= 10) return `${arabicBelowThousand(n)} ${scale.plural}`;
  if (rest >= 11) return `${arabicBelowThousand(n)} ${scale.accusative}`;
  return `${arabicBelowThousand(n)} ${scale.one}`;
}

export function integerToArabic(value: bigint): string {
  if (value === 0n) return 'صفر';
  const groups: number[] = [];
  let n = value < 0n ? -value : value;
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    words.push(arabicGroup(groups[i], i));
  }
  return words.join(' و');
}

// ---------------------------------------------------------------------------
// Amounts with currency
// ---------------------------------------------------------------------------
export interface CurrencyWords {
  code: string;
  name_en: string;
  name_ar: string;
  decimals: number;
}

/**
 * Formal amount in words for vouchers, e.g.
 *  en: "One million Iraqi Dinar only"
 *  ar: "فقط مليون دينار عراقي لا غير"
 */
export function amountInWords(units: Units, currency: CurrencyWords, language: 'en' | 'ar'): string {
  const abs = units < 0n ? -units : units;
  const whole = abs / SCALE;
  const decimals = Math.max(0, Math.min(currency.decimals, 4));
  const fractionFactor = 10n ** BigInt(decimals);
  const fraction = decimals > 0 ? ((abs % SCALE) * fractionFactor) / SCALE : 0n;

  if (language === 'ar') {
    let text = `فقط ${integerToArabic(whole)} ${currency.name_ar}`;
    if (fraction > 0n) text += ` و${fraction.toString()}/${fractionFactor.toString()}`;
    return `${text} لا غير`;
  }
  let text = `${integerToEnglish(whole)} ${currency.name_en}`;
  if (fraction > 0n) text += ` and ${fraction.toString()}/${fractionFactor.toString()}`;
  text = `${text} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
