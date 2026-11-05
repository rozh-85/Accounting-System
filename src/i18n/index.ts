import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar } from './ar/translation';
import { en } from './en/translation';

export type Language = 'en' | 'ar';
export const LANGUAGE_STORAGE_KEY = 'vio.language';

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('ar') ? 'ar' : 'en';
}

export function applyDocumentDirection(language: Language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: typeof window === 'undefined' ? 'en' : initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentDirection(i18n.language as Language);
i18n.on('languageChanged', (lng) => {
  applyDocumentDirection(lng as Language);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* storage unavailable */
  }
});

export default i18n;
