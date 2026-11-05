import { Font } from '@react-pdf/renderer';

export const PDF_FONT_AR = 'PlexArabic';
export const PDF_FONT_EN = 'PlexSans';

export interface PdfFontFamilies {
  ar: string;
  en: string;
}

const WEIGHTS: Array<[string, number]> = [
  ['Regular', 400],
  ['Medium', 500],
  ['SemiBold', 600],
  ['Bold', 700],
];

let generation = 0;
let hyphenationRegistered = false;

function registerFamilies(base: string, ar: string, en: string) {
  Font.register({
    family: ar,
    fonts: WEIGHTS.map(([name, fontWeight]) => ({ src: `${base}IBMPlexSansArabic-${name}.woff`, fontWeight })),
  });
  Font.register({
    family: en,
    fonts: WEIGHTS.map(([name, fontWeight]) => ({ src: `${base}IBMPlexSans-${name}.woff`, fontWeight })),
  });
  if (!hyphenationRegistered) {
    // Never hyphenate account names, codes or amounts.
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationRegistered = true;
  }
}

/**
 * Registers the embedded report fonts under new family names for one document.
 *
 * IBM Plex Sans Arabic contains full Arabic shaping tables (connected letter
 * forms, lam-alef ligatures) and Latin glyphs; IBM Plex Sans is used for
 * English reports with Arabic fallback.
 *
 * Every document gets its own font instances: fontkit keeps layout state on
 * font objects, and reusing them across documents was observed to corrupt
 * Arabic ligature mapping (a dropped alef before lam-alef). The font files stay
 * in the browser's HTTP cache, so this only costs re-parsing.
 *
 * @param base URL or filesystem directory containing the .woff files.
 */
export function registerPdfFonts(base = '/fonts/pdf/'): PdfFontFamilies {
  generation += 1;
  const families = { ar: `${PDF_FONT_AR}-${generation}`, en: `${PDF_FONT_EN}-${generation}` };
  registerFamilies(base, families.ar, families.en);
  return families;
}
