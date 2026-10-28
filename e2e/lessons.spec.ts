import { expect, test } from '@playwright/test'
import { addNote, boardPoint, createLesson, drawStroke, signIn, signUp, waitForSaved } from './support/app'

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

    test('warns before reload while a workspace save is pending', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'Pending-save warning')
        await addNote(page, 'Keep this change', [0.5, 0.3])

        const reloadWasPrevented = await page.evaluate(() => {
            const event = new Event('beforeunload', { cancelable: true })
            window.dispatchEvent(event)
            return event.defaultPrevented
        })
        expect(reloadWasPrevented).toBe(true)
        await expect(page.getByText('Keep this change')).toBeVisible()

        await waitForSaved(page)
        await page.reload()
        await page.getByText('Pending-save warning').first().click()
        await expect(page.getByText('Keep this change')).toBeVisible()
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

    test('adds text, shapes, grids, and a web page to a lesson board', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'Board item types')

        await page.getByRole('button', { name: 'Text', exact: true }).click()
        const textPoint = await boardPoint(page, 0.2, 0.2)
        await page.mouse.click(textPoint.x, textPoint.y)
        await page.getByPlaceholder('Type here…').fill('Board text')
        await page.keyboard.press('Control+Enter')
        await expect(page.getByText('Board text')).toBeVisible()

        await page.getByRole('button', { name: 'Shapes' }).click()
        await page.getByRole('button', { name: 'Square shape' }).click()
        const shapePoint = await boardPoint(page, 0.5, 0.3)
        await page.mouse.click(shapePoint.x, shapePoint.y)
        await expect(page.locator('.board-item')).toHaveCount(2)

        await page.getByRole('button', { name: 'Word grid' }).click()
        const gridPoint = await boardPoint(page, 0.3, 0.6)
        await page.mouse.click(gridPoint.x, gridPoint.y)
        await expect(page.locator('.board-item')).toHaveCount(3)

        await page.getByRole('button', { name: 'Add a web page or game' }).click()
        await page.getByRole('textbox', { name: 'Web address' }).fill('https://example.com')
        await page.getByRole('button', { name: 'Check page' }).click()
        await expect(page.locator('.web-check')).toBeVisible()
        await page.getByRole('button', { name: /Add (it anyway|to page)/ }).click()
        await expect(page.locator('.board-item')).toHaveCount(4)
        await expect(page.getByText('example.com')).toBeVisible()
    })

    test('adds a PDF and an image through file upload', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'Uploaded media')
        const upload = page.locator('input[type="file"][accept="image/*,application/pdf"]')
        await upload.setInputFiles({
            name: 'worksheet.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
        })
        await expect(page.locator('.board-item')).toHaveCount(1)

        const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64')
        await upload.setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: onePixelPng })
        await expect(page.getByRole('dialog', { name: 'Crop image' })).toBeVisible()
        await page.getByRole('button', { name: 'Add without cropping' }).click()
        await expect(page.locator('.board-item')).toHaveCount(2)
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
