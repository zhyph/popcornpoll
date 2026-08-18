// app/localeAction.ts
'use server'

import { cookies } from 'next/headers'
import type { Locale } from '../i18n/request'

export async function setLocaleAction(locale: Locale): Promise<void> {
  const store = await cookies()
  store.set('locale', locale, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
}
