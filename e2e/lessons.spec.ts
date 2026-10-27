import { expect, test } from '@playwright/test'
import { addNote, createLesson, drawStroke, signIn, signUp, waitForSaved } from './support/app'

test.describe('lessons and board', () => {
    test('new workspace is seeded with a demo lesson and folder', async ({ page }) => {
        await signUp(page)
        await expect(page.getByRole('heading', { name: /Short vowels at family/ })).toBeVisible()
        await expect(page.getByRole('navigation').getByText('Demo student')).toBeVisible()
    })

    test('creates a lesson that appears in the library and survives reload', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'My first lesson')
        await expect(page.getByText('My first lesson').first()).toBeVisible()
        await waitForSaved(page)
        await page.reload()
        await expect(page.getByText('My first lesson').first()).toBeVisible()
    })

    test('draws strokes and adds a note, then restores them after sign-out and sign-in', async ({ page }) => {
        const email = await signUp(page)
        await createLesson(page, 'Board persistence')
        await drawStroke(page, 'Pen', [0.2, 0.2], [0.4, 0.3])
        await drawStroke(page, 'Highlighter', [0.2, 0.5], [0.5, 0.5])
        await addNote(page, 'Remember the vowels', [0.6, 0.3])
        await expect(page.locator('.board-item')).toHaveCount(3)
        await expect(page.getByText('Remember the vowels')).toBeVisible()
        await waitForSaved(page)

        await page.getByRole('button', { name: 'Sign out' }).click()
        await signIn(page, email)
        await page.getByText('Board persistence').first().click()
        await expect(page.locator('.board-item')).toHaveCount(3)
        await expect(page.getByText('Remember the vowels')).toBeVisible()
    })

    test('undo and redo revert and restore items', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'Undo lesson')
        await drawStroke(page, 'Pen', [0.2, 0.2], [0.4, 0.3])
        await expect(page.locator('.board-item')).toHaveCount(1)
        await page.getByRole('button', { name: 'Undo' }).click()
        await expect(page.locator('.board-item')).toHaveCount(0)
        await page.getByRole('button', { name: 'Redo' }).click()
        await expect(page.locator('.board-item')).toHaveCount(1)
    })

    test('cancelling the note dialog adds nothing', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'Cancel note')
        await page.getByRole('button', { name: 'Post-it' }).click()
        const box = (await page.locator('.page-paper').boundingBox())!
        await page.mouse.click(box.x + 200, box.y + 150)
        await page.getByRole('button', { name: 'Cancel' }).click()
        await expect(page.locator('.board-item')).toHaveCount(0)
    })

    test("one teacher cannot see another teacher's lessons", async ({ browser }) => {
        const first = await (await browser.newContext()).newPage()
        const second = await (await browser.newContext()).newPage()
        await signUp(first)
        await createLesson(first, 'Private to first teacher')
        await waitForSaved(first)
        await signUp(second)
        await expect(second.getByText('Private to first teacher')).toHaveCount(0)
        await first.context().close()
        await second.context().close()
    })
})
