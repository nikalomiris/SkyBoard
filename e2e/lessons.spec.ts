import { expect, test } from '@playwright/test'
import { addNote, boardPoint, createLesson, drawStroke, signIn, signUp, waitForSaved } from './support/app'
import { makeSupportedImageFiles } from './support/images'

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

    test('adds text, shapes, and grids to a lesson board', async ({ page }) => {
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
    })

    test('adds, crops, saves, and reloads each supported image extension', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'Image formats')
        const upload = page.locator('input[type="file"][accept="image/*,application/pdf"]')
        const formats = await makeSupportedImageFiles(page)

        for (const format of formats) {
            await upload.setInputFiles({
                name: format.name,
                mimeType: format.mimeType,
                buffer: format.buffer,
            })
            const cropDialog = page.getByRole('dialog', { name: 'Crop image' })
            await expect(cropDialog).toBeVisible()
            await expect.poll(() => cropDialog.locator('.crop-frame img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
            await page.getByRole('button', { name: 'Crop and add' }).click()

            const image = page.locator(`.board-item img[alt="${format.name}"]`)
            await expect(image).toBeVisible()
            await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
            await expect(image).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
        }

        await expect(page.locator('.board-item')).toHaveCount(formats.length)
        await expect(page.getByRole('alert')).toHaveCount(0)
        await waitForSaved(page)
        await page.reload()
        await page.getByText('Image formats').first().click()

        for (const format of formats) {
            const image = page.locator(`.board-item img[alt="${format.name}"]`)
            await expect(image).toBeVisible()
            await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
        }
        await expect(page.locator('.board-item')).toHaveCount(formats.length)
    })

    test('adds a PDF through file upload', async ({ page }) => {
        await signUp(page)
        await createLesson(page, 'PDF upload')
        const upload = page.locator('input[type="file"][accept="image/*,application/pdf"]')
        await upload.setInputFiles({
            name: 'worksheet.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
        })
        await expect(page.locator('.board-item')).toHaveCount(1)
        await expect(page.locator('.board-item')).toContainText('worksheet.pdf')
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
