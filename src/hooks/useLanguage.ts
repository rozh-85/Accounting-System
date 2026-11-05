import { useTranslation } from 'react-i18next';
import type { Language } from '@/i18n';

export function useLanguage() {
  const { i18n } = useTranslation();
  const language = (i18n.language === 'ar' ? 'ar' : 'en') as Language;
  return {
    language,
    isRtl: language === 'ar',
    setLanguage: (lng: Language) => void i18n.changeLanguage(lng),
    /** Picks the localized field, e.g. name(account) → name_ar in Arabic. */
    name: (item: { name_en: string; name_ar: string } | null | undefined) =>
      item ? (language === 'ar' ? item.name_ar : item.name_en) : '',
  };
}
