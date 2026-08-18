// e2e/chrome.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale } from './fixtures'

test('shared chrome renders on the box office screen', async ({ page, baseURL }) => {
  // Chrome text is now sourced from next-intl (Fix 2 of the final review
  // wave), and DEFAULT_LOCALE is 'pt-br' — pin English here like every other
  // e2e spec does via pinEnglishLocale, so these assertions on English copy
  // stay meaningful regardless of the app's default locale.
  await pinEnglishLocale(page.context(), baseURL!)
  await page.goto('/')
  await expect(page.getByRole('banner').getByText('POPCORNPOLL')).toBeVisible()
  await expect(page.getByTestId('chapter-indicator')).toBeVisible()
  await expect(page.getByTestId('curtain-overlay')).toBeAttached()
  await expect(page.getByRole('contentinfo').getByText('self-hosted', { exact: false })).toBeVisible()
})

test('chapter indicator is hidden on the setup screen', async ({ page, baseURL }) => {
  await pinEnglishLocale(page.context(), baseURL!)
  await page.goto('/setup')
  await expect(page.getByTestId('chapter-indicator')).not.toBeAttached()
})
