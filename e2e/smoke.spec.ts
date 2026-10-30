import { expect, test } from '@playwright/test'

test('app loads and shows the sign-in screen', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await expect(page.getByRole('button', { name: /sign in|log in/i }).first()).toBeVisible()
    expect(errors).toEqual([])
})
