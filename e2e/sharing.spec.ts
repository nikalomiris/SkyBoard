import { expect, test } from '@playwright/test'
import { addNote, boardPoint, createLesson, newTeacher, openStudent, shareLesson, signUp, waitForSaved } from './support/app'
import { makeSupportedImageFiles } from './support/images'

test.describe('lesson sharing and live collaboration', () => {
    test('sharing immediately after creating a lesson saves it before starting the room', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Share without waiting')

        await teacher.page.getByRole('button', { name: 'Share lesson' }).click()
        await expect(teacher.page.getByText(/Lesson room is live/)).toBeVisible()
        await expect(teacher.page.getByRole('alert')).toHaveCount(0)

        await teacher.context.close()
    })

    test('a student joins by link, sees existing content, and receives live teacher edits', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Live lesson')
        await addNote(teacher.page, 'Hello class', [0.5, 0.3])
        const link = await shareLesson(teacher.page)
        const student = await openStudent(browser, link)

        await expect(student.page.getByText('Hello class')).toBeVisible()
        await expect(teacher.page.getByRole('button', { name: 'Student connected' })).toBeVisible()

        await teacher.page.getByRole('button', { name: 'Close' }).click()
        await addNote(teacher.page, 'Live note', [0.2, 0.6])
        await expect(student.page.getByText('Live note')).toBeVisible()

        await teacher.context.close()
        await student.context.close()
    })

    test('the student follows every page containing a different board item or background', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Mixed page lesson')

        const addBlankPage = async () => {
            const addPageButton = teacher.page.getByRole('button', { name: 'Add page' })
            if (!(await addPageButton.isVisible())) {
                await teacher.page.getByRole('button', { name: 'Browse and manage pages' }).click()
            }
            await addPageButton.click()
        }
        for (let index = 0; index < 6; index++) await addBlankPage()
        await expect(teacher.page.getByRole('button', { name: 'Browse and manage pages' })).toContainText('7/7')
        for (let index = 0; index < 6; index++) await teacher.page.getByRole('button', { name: 'Previous page' }).click()
        await expect(teacher.page.getByRole('button', { name: 'Browse and manage pages' })).toContainText('1/7')

        const strokeStart = await teacher.page.locator('.page-paper').boundingBox()
        if (!strokeStart) throw new Error('Teacher board is not visible')
        await teacher.page.getByRole('button', { name: 'Pen', exact: true }).click()
        await teacher.page.mouse.move(strokeStart.x + strokeStart.width * 0.2, strokeStart.y + strokeStart.height * 0.2)
        await teacher.page.mouse.down()
        await teacher.page.mouse.move(strokeStart.x + strokeStart.width * 0.4, strokeStart.y + strokeStart.height * 0.25, { steps: 8 })
        await teacher.page.mouse.up()

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await teacher.page.getByRole('button', { name: 'Word grid' }).click()
        const gridPoint = await boardPoint(teacher.page, 0.2, 0.25)
        await teacher.page.mouse.click(gridPoint.x, gridPoint.y)
        await teacher.page.getByRole('textbox', { name: 'Grid cell 1' }).fill('GRID_PAGE_MARKER')

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await teacher.page.getByRole('button', { name: 'Text', exact: true }).click()
        const textPoint = await boardPoint(teacher.page, 0.2, 0.25)
        await teacher.page.mouse.click(textPoint.x, textPoint.y)
        await teacher.page.getByPlaceholder('Type here…').fill('TEXT_PAGE_MARKER')
        await teacher.page.keyboard.press('Control+Enter')

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        const imageUpload = teacher.page.locator('input[type="file"][accept="image/*,application/pdf"]')
        const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64')
        await imageUpload.setInputFiles({ name: 'image-page.png', mimeType: 'image/png', buffer: onePixelPng })
        await teacher.page.getByRole('button', { name: 'Add without cropping' }).click()

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await teacher.page.getByRole('button', { name: 'Set background' }).click()
        await teacher.page.getByRole('button', { name: 'Set #fdeef2 background' }).click()
        await teacher.page.getByRole('button', { name: 'Close background panel' }).click()

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await teacher.page.getByRole('button', { name: 'Shapes' }).click()
        await teacher.page.getByRole('button', { name: 'Circle shape' }).click()
        const shapePoint = await boardPoint(teacher.page, 0.2, 0.25)
        await teacher.page.mouse.click(shapePoint.x, shapePoint.y)

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await addNote(teacher.page, 'NOTE_PAGE_MARKER', [0.2, 0.25])
        await waitForSaved(teacher.page)

        for (let index = 0; index < 6; index++) {
            await teacher.page.getByRole('button', { name: 'Previous page' }).click()
        }
        await expect(teacher.page.getByRole('button', { name: 'Browse and manage pages' })).toContainText('1/7')

        const student = await openStudent(browser, await shareLesson(teacher.page))
        await teacher.page.getByRole('button', { name: 'Close' }).click()

        const studentSvg = student.page.getByLabel('Lesson whiteboard content')
        await expect(studentSvg.locator('g.board-item > path')).toHaveCount(1)
        await expect(studentSvg.locator('.board-grid input').first()).toHaveCount(0)

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await expect(studentSvg.locator('.board-grid input').first()).toHaveValue('GRID_PAGE_MARKER')
        await expect(studentSvg.locator('g.board-item')).toHaveCount(1)

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await expect(studentSvg.locator('text')).toContainText('TEXT_PAGE_MARKER')
        await expect(studentSvg.locator('g.board-item')).toHaveCount(1)

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await expect(studentSvg.locator('img[alt="image-page.png"]')).toBeVisible()
        await expect(studentSvg.locator('g.board-item')).toHaveCount(1)

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await expect(student.page.locator('.page-paper')).toHaveCSS('background-color', 'rgb(253, 238, 242)')
        await expect(studentSvg.locator('g.board-item')).toHaveCount(0)

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await expect(studentSvg.locator('g.board-item > circle')).toHaveCount(1)

        await teacher.page.getByRole('button', { name: 'Next page' }).click()
        await expect(student.page.getByText('NOTE_PAGE_MARKER')).toBeVisible()
        await expect(studentSvg.locator('g.board-item')).toHaveCount(1)

        await teacher.context.close()
        await student.context.close()
    })

    test('the student receives every supported image format across lesson pages', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Shared image formats')

        const formats = await makeSupportedImageFiles(teacher.page)
        const upload = teacher.page.locator('input[type="file"][accept="image/*,application/pdf"]')
        const addBlankPage = async () => {
            const addPageButton = teacher.page.getByRole('button', { name: 'Add page' })
            if (!(await addPageButton.isVisible())) {
                await teacher.page.getByRole('button', { name: 'Browse and manage pages' }).click()
            }
            await addPageButton.click()
        }

        for (const [index, format] of formats.entries()) {
            await upload.setInputFiles({
                name: format.name,
                mimeType: format.mimeType,
                buffer: format.buffer,
            })
            const cropDialog = teacher.page.getByRole('dialog', { name: 'Crop image' })
            await expect(cropDialog).toBeVisible()
            await expect.poll(() => cropDialog.locator('.crop-frame img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
            await teacher.page.getByRole('button', { name: 'Crop and add' }).click()

            const image = teacher.page.locator(`.board-item img[alt="${format.name}"]`)
            await expect(image).toBeVisible()
            await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
            if (index < formats.length - 1) await addBlankPage()
        }

        await waitForSaved(teacher.page)
        for (let index = 1; index < formats.length; index++) {
            await teacher.page.getByRole('button', { name: 'Previous page' }).click()
        }
        await expect(teacher.page.getByRole('button', { name: 'Browse and manage pages' })).toContainText(`1/${formats.length}`)

        const student = await openStudent(browser, await shareLesson(teacher.page))
        await teacher.page.getByRole('button', { name: 'Close' }).click()
        const studentSvg = student.page.getByLabel('Lesson whiteboard content')

        for (const [index, format] of formats.entries()) {
            const studentImage = studentSvg.locator(`img[alt="${format.name}"]`)
            await expect(studentImage).toBeVisible()
            await expect.poll(() => studentImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
            if (index < formats.length - 1) {
                await teacher.page.getByRole('button', { name: 'Next page' }).click()
            }
        }

        await teacher.context.close()
        await student.context.close()
    })

    test('the student view is restricted: no sharing, and only drawing tools', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Restricted lesson')
        const student = await openStudent(browser, await shareLesson(teacher.page))
        await expect(student.page.locator('.page-paper')).toBeVisible()

        await expect(student.page.getByRole('button', { name: 'Share lesson' })).toHaveCount(0)
        await expect(student.page.getByRole('button', { name: 'Post-it' })).toHaveCount(0)
        await expect(student.page.getByRole('button', { name: 'Shapes' })).toHaveCount(0)
        await expect(student.page.getByRole('button', { name: 'Word grid' })).toHaveCount(0)
        await expect(student.page.getByRole('button', { name: 'Pen', exact: true })).toBeVisible()
        await expect(student.page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)

        await teacher.context.close()
        await student.context.close()
    })

    test('a student who needs approval waits until the teacher admits them', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Approval lesson')
        await addNote(teacher.page, 'Secret until admitted', [0.5, 0.3])
        const student = await openStudent(browser, await shareLesson(teacher.page, { requireApproval: true }))

        await expect(student.page.locator('.page-paper')).toBeHidden()
        await expect(student.page.getByText('Secret until admitted')).toHaveCount(0)

        await teacher.page.getByRole('button', { name: 'Close' }).click()
        await teacher.page.getByRole('button', { name: 'Admit Sam' }).click()

        await expect(student.page.getByText('Secret until admitted')).toBeVisible()

        await teacher.context.close()
        await student.context.close()
    })

    test('denying a waiting student keeps them out', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Deny lesson')
        await addNote(teacher.page, 'Not for you', [0.5, 0.3])
        const student = await openStudent(browser, await shareLesson(teacher.page, { requireApproval: true }))

        await teacher.page.getByRole('button', { name: 'Close' }).click()
        await teacher.page.getByRole('button', { name: 'Deny Sam' }).click()

        await expect(student.page.getByRole('heading', { name: /removed from this lesson/ })).toBeVisible()
        await expect(student.page.getByText('Not for you')).toHaveCount(0)

        await teacher.context.close()
        await student.context.close()
    })

    test('ending the lesson blocks the student and invalidates the link', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Ending lesson')
        const link = await shareLesson(teacher.page)
        const student = await openStudent(browser, link)
        await expect(student.page.locator('.page-paper')).toBeVisible()

        teacher.page.once('dialog', (dialog) => void dialog.accept())
        await teacher.page.getByRole('button', { name: 'End lesson for everyone' }).click()
        await expect(student.page.getByRole('heading', { name: 'This lesson has ended' })).toBeVisible()
        await expect(student.page.locator('.page-paper')).toBeHidden()

        const late = await openStudent(browser, link)
        await expect(late.page.getByRole('heading', { name: 'This lesson has ended' })).toBeVisible()

        await teacher.context.close()
        await student.context.close()
        await late.context.close()
    })

    test('removing a student revokes their access', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Removal lesson')
        const student = await openStudent(browser, await shareLesson(teacher.page))
        await expect(student.page.locator('.page-paper')).toBeVisible()

        await teacher.page.locator('.invite-row', { hasText: 'Sam' }).getByRole('button', { name: 'Remove' }).click()
        await expect(student.page.getByRole('heading', { name: /removed from this lesson/ })).toBeVisible()
        await expect(student.page.locator('.page-paper')).toBeHidden()

        await teacher.context.close()
        await student.context.close()
    })

    test('a tampered student token is rejected and leaks nothing', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Owner lesson')
        const link = await shareLesson(teacher.page)
        const tampered = link.replace(/token=.*/, 'token=' + 'x'.repeat(32))
        const student = await openStudent(browser, tampered)
        await expect(student.page.locator('.page-paper')).toBeHidden()
        await expect(student.page.getByText('Owner lesson')).toHaveCount(0)

        await teacher.context.close()
        await student.context.close()
    })
})
