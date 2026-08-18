// i18n/request.ts
import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export const SUPPORTED_LOCALES = ['pt-br', 'en-us'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'pt-br'

export function isSupportedLocale(value: string | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale)
}

export default getRequestConfig(async () => {
  const store = await cookies()
  const cookieLocale = store.get('locale')?.value
  const locale: Locale = isSupportedLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const messages = (await import(`../messages/${locale}.json`)).default
  return { locale, messages }
})
