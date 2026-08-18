// e2e/chrome.spec.ts
import { test, expect } from '@playwright/test'

test('shared chrome renders on the box office screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('banner').getByText('POPCORNPOLL')).toBeVisible()
  await expect(page.getByTestId('chapter-indicator')).toBeVisible()
  await expect(page.getByTestId('curtain-overlay')).toBeAttached()
  await expect(page.getByRole('contentinfo').getByText('self-hosted', { exact: false })).toBeVisible()
})

test('chapter indicator is hidden on the setup screen', async ({ page }) => {
  await page.goto('/setup')
  await expect(page.getByTestId('chapter-indicator')).not.toBeAttached()
})
