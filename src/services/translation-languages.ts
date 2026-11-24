export const languageOptions = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' }
] as const;

export function normalizeLanguage(value: string | null): string | null {
  if (!value) return null;
  const parts = value.trim().split('-');
  const normalized = parts[0].toLowerCase() + (parts.length === 2 ? `-${parts[1].toUpperCase()}` : '');
  return parts.length <= 2 && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(normalized) ? normalized : null;
}

// A deployment must explicitly mirror its backend SUPPORTED_LANGUAGES here.
export const translationLanguages = (import.meta.env.VITE_TRANSLATION_LANGUAGES ?? '')
  .split(',').map((value: string) => normalizeLanguage(value)).filter((value: string | null): value is string =>
    value !== null && languageOptions.some((option) => option.code === value));

export function languageLabel(value: string | null): string {
  return languageOptions.find((option) => option.code === value)?.label ?? value ?? 'Unknown';
}
