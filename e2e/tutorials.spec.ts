import { expect, test } from '@playwright/test'
import { createLesson, newTeacher, openStudent, shareLesson, signUp } from './support/app'

// Tutorials are disabled globally in playwright.config.ts; these tests need them on.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('interface tutorials', () => {
    test('library tutorial shows once, can be skipped, and can be replayed', async ({ page }) => {
        await signUp(page)
        const tutorial = page.getByRole('dialog', { name: 'Tutorial' })
        await expect(tutorial).toBeVisible()
        await expect(tutorial.getByText('Step 1 of 4')).toBeVisible()
        await tutorial.getByRole('button', { name: 'Next' }).click()
        await expect(tutorial.getByText('Step 2 of 4')).toBeVisible()
        await tutorial.getByRole('button', { name: 'Skip' }).click()
        await expect(tutorial).toBeHidden()

        await page.reload()
        await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeVisible()
        await expect(tutorial).toBeHidden()

        await page.getByRole('button', { name: 'Show tutorial' }).click()
        await expect(tutorial).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(tutorial).toBeHidden()
    })

    test('board tutorial appears on first lesson open and not again', async ({ page }) => {
        await signUp(page)
        await page.getByRole('button', { name: 'Skip' }).click()
        await createLesson(page, 'Tutorial lesson')
        const tutorial = page.getByRole('dialog', { name: 'Tutorial' })
        await expect(tutorial.getByText('Whiteboard tools')).toBeVisible()
        for (let i = 0; i < 4; i++) await tutorial.getByRole('button', { name: 'Next' }).click()
        await tutorial.getByRole('button', { name: 'Done' }).click()
        await expect(tutorial).toBeHidden()

        await page.getByRole('button', { name: 'Go to SkyBoard home' }).click()
        await page.getByText('Tutorial lesson').first().click()
        await expect(page.locator('.page-paper')).toBeVisible()
        await expect(tutorial).toBeHidden()
    })

    test('share dialog and blending board have their own tutorials with replay buttons', async ({ page }) => {
        await signUp(page)
        const tutorial = page.getByRole('dialog', { name: 'Tutorial' })
        await tutorial.getByRole('button', { name: 'Skip' }).click()
        await createLesson(page, 'Per-interface tutorials')
        await tutorial.getByRole('button', { name: 'Skip' }).click()

        await page.getByRole('button', { name: 'Blending board' }).click()
        await expect(tutorial.getByText('Sound categories')).toBeVisible()
        await tutorial.getByRole('button', { name: 'Skip' }).click()
        await page.getByRole('button', { name: 'Close blending board' }).click()

        await page.getByRole('button', { name: 'Share lesson' }).click()
        await expect(tutorial.getByText('Invite your students')).toBeVisible()
        await tutorial.getByRole('button', { name: 'Close' }).click()
        await expect(page.getByRole('button', { name: 'Show tutorial' })).toHaveCount(2)
    })

    test('card deck and matching game have their own tutorials', async ({ page }) => {
        await signUp(page)
        const tutorial = page.getByRole('dialog', { name: 'Tutorial' })
        await tutorial.getByRole('button', { name: 'Skip' }).click()
        await createLesson(page, 'Deck and match tutorials')
        await tutorial.getByRole('button', { name: 'Skip' }).click()

        await page.getByRole('button', { name: 'Card deck', exact: true }).click()
        await expect(tutorial.getByText('Choose the tiles')).toBeVisible()
        await tutorial.getByRole('button', { name: 'Skip' }).click()
        await page.getByRole('button', { name: 'Close card deck' }).click()
        await page.getByRole('button', { name: 'Card deck', exact: true }).click()
        await expect(tutorial).toBeHidden()
        await page.getByRole('dialog', { name: 'Card deck' }).getByRole('button', { name: 'Show tutorial' }).click()
        await expect(tutorial.getByText('Choose the tiles')).toBeVisible()
        await tutorial.getByRole('button', { name: 'Skip' }).click()
        await page.getByRole('button', { name: 'Close card deck' }).click()

        await page.getByRole('button', { name: 'Matching game', exact: true }).click()
        await expect(tutorial.getByText('Add your words')).toBeVisible()
        await tutorial.getByRole('button', { name: 'Skip' }).click()
        await expect(page.getByRole('dialog', { name: 'Matching game' }).getByRole('button', { name: 'Show tutorial' })).toBeVisible()
    })

    test('students never see tutorials or help buttons', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await teacher.page.getByRole('button', { name: 'Skip' }).click()
        await createLesson(teacher.page, 'Student view lesson')
        await teacher.page.getByRole('button', { name: 'Skip' }).click()
        await teacher.page.getByRole('button', { name: 'Share lesson' }).click()
        await teacher.page.getByRole('dialog', { name: 'Tutorial' }).getByRole('button', { name: 'Close' }).click()
        await teacher.page.locator('.invite-modal .modal-close').click()
        const link = await shareLesson(teacher.page)
        const student = await openStudent(browser, link)

        await expect(student.page.locator('.page-paper')).toBeVisible()
        await expect(student.page.getByRole('dialog', { name: 'Tutorial' })).toHaveCount(0)
        await expect(student.page.getByRole('button', { name: 'Show tutorial' })).toHaveCount(0)

        await teacher.context.close()
        await student.context.close()
    })
})
