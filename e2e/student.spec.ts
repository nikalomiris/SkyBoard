import { expect, test } from '@playwright/test'

test.describe('student access', () => {
    test('?view=student without a token does not expose a workspace', async ({ page }) => {
        await page.goto('/?view=student')
        await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeHidden()
        await expect(page.locator('.page-paper')).toBeHidden()
    })

    test('an invalid student token shows an error rather than lesson data', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto('/?view=student&token=definitely-not-valid')
        await expect(page.locator('.page-paper')).toBeHidden()
        expect(errors).toEqual([])
    })
})
