import { expect, test, type Browser, type Page } from '@playwright/test'
import { addNote, boardPoint, createLesson, newTeacher, openStudent, shareLesson, signUp, waitForSaved } from './support/app'

const strokes = (page: Page) => page.locator('.drawing-layer .board-item path')

// Drags across the board with the currently selected tool (selecting a tool twice would toggle it off).
async function drag(page: Page, from: [number, number], to: [number, number]) {
    const start = await boardPoint(page, ...from)
    const end = await boardPoint(page, ...to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
}

const selectTool = (page: Page, name: 'Pen' | 'Eraser') => page.getByRole('button', { name, exact: true }).click()

// Adds another student invite to an already-open share dialog and returns its link.
async function addInvite(page: Page, name: string) {
    await page.getByRole('textbox', { name: 'Student name' }).fill(name)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const row = page.locator('.invite-row', { hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Copy link' }).click()
    return page.evaluate(() => navigator.clipboard.readText())
}

async function startRoom(browser: Browser, studentNames: string[]) {
    const teacher = await newTeacher(browser)
    await signUp(teacher.page)
    await createLesson(teacher.page, 'Collaboration')
    const [first, ...others] = studentNames
    const links = [await shareLesson(teacher.page, { name: first })]
    for (const name of others) links.push(await addInvite(teacher.page, name))
    const students = []
    for (const link of links) {
        const student = await openStudent(browser, link)
        await expect(student.page.locator('.page-paper')).toBeVisible()
        students.push(student)
    }
    await teacher.page.getByRole('button', { name: 'Close' }).click()
    return { teacher, students }
}

test.describe('teacher and student drawing collaboration', () => {
    test('both strokes of an "x" drawn by a student survive and reach the teacher', async ({ browser }) => {
        const { teacher, students } = await startRoom(browser, ['Sam'])
        const [student] = students
        await selectTool(student.page, 'Pen')

        await drag(student.page, [0.3, 0.3], [0.4, 0.5])
        await drag(student.page, [0.4, 0.3], [0.3, 0.5])

        await expect(strokes(student.page)).toHaveCount(2)
        await expect(strokes(teacher.page)).toHaveCount(2)
        // Wait past the teacher's rebroadcast debounce and the unconfirmed-edit window to catch late overwrites.
        await student.page.waitForTimeout(1500)
        await expect(strokes(student.page)).toHaveCount(2)
        await expect(strokes(teacher.page)).toHaveCount(2)

        await teacher.context.close()
        await student.context.close()
    })

    test('several students drawing at the same time all keep their strokes', async ({ browser }) => {
        const { teacher, students } = await startRoom(browser, ['Ann', 'Ben', 'Cy'])
        for (const student of students) await selectTool(student.page, 'Pen')

        await Promise.all(students.map((student, index) => (async () => {
            const row = 0.2 + index * 0.2
            await drag(student.page, [0.2, row], [0.4, row + 0.05])
            await drag(student.page, [0.5, row], [0.7, row + 0.05])
        })()))

        await expect(strokes(teacher.page)).toHaveCount(6)
        for (const student of students) await expect(strokes(student.page)).toHaveCount(6)
        await teacher.page.waitForTimeout(1500)
        await expect(strokes(teacher.page)).toHaveCount(6)
        for (const student of students) await expect(strokes(student.page)).toHaveCount(6)

        await teacher.context.close()
        for (const student of students) await student.context.close()
    })

    test('a teacher edit during student drawing does not erase the student strokes', async ({ browser }) => {
        const { teacher, students } = await startRoom(browser, ['Sam'])
        const [student] = students
        await selectTool(student.page, 'Pen')
        await selectTool(teacher.page, 'Pen')

        await drag(student.page, [0.2, 0.3], [0.3, 0.4])
        await expect(strokes(teacher.page)).toHaveCount(1)
        await drag(teacher.page, [0.6, 0.3], [0.7, 0.4])
        await drag(student.page, [0.2, 0.6], [0.3, 0.7])

        await expect(strokes(teacher.page)).toHaveCount(3)
        await expect(strokes(student.page)).toHaveCount(3)

        await teacher.context.close()
        await student.context.close()
    })

    test('erasing by one student removes only their stroke', async ({ browser }) => {
        const { teacher, students } = await startRoom(browser, ['Ann', 'Ben'])
        const [ann, ben] = students
        await selectTool(ann.page, 'Pen')
        await selectTool(ben.page, 'Pen')

        await drag(ann.page, [0.2, 0.3], [0.3, 0.4])
        await expect(strokes(ben.page)).toHaveCount(1)
        await drag(ben.page, [0.5, 0.3], [0.6, 0.4])
        await expect(strokes(teacher.page)).toHaveCount(2)

        await selectTool(ann.page, 'Eraser')
        await drag(ann.page, [0.2, 0.3], [0.3, 0.4])
        await expect(strokes(teacher.page)).toHaveCount(1)
        await expect(strokes(ben.page)).toHaveCount(1)
        await expect(strokes(ann.page)).toHaveCount(1)

        await teacher.context.close()
        await ann.context.close()
        await ben.context.close()
    })
})

async function setLock(teacher: Page, menuItem: RegExp | string) {
    await teacher.getByRole('button', { name: /Student(s)? connected/ }).click()
    await teacher.getByRole('menuitem', { name: menuItem }).click()
    await closeStudentMenu(teacher)
}

async function closeStudentMenu(teacher: Page) {
    await teacher.locator('.student-menu-scrim').click({ position: { x: 5, y: 5 } })
    await expect(teacher.getByRole('menu')).toBeHidden()
}

async function center(locator: ReturnType<Page['getByText']>) {
    const box = await locator.boundingBox()
    if (!box) throw new Error('Element is not visible')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function dragPixels(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
    await page.mouse.up()
}

test.describe('student moving elements', () => {
    test('a student can move an element with the Select tool and the teacher sees it move', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Move')
        await addNote(teacher.page, 'Movable', [0.3, 0.3])
        const student = await openStudent(browser, await shareLesson(teacher.page))
        await expect(student.page.getByText('Movable')).toBeVisible()
        await teacher.page.getByRole('button', { name: 'Close' }).click()

        await student.page.getByRole('button', { name: 'Select', exact: true }).click()
        const before = await teacher.page.getByText('Movable').boundingBox()
        await dragPixels(student.page, await center(student.page.getByText('Movable')), 120, 80)

        await expect.poll(async () => (await teacher.page.getByText('Movable').boundingBox())?.x ?? 0).toBeGreaterThan((before?.x ?? 0) + 50)
        await expect.poll(async () => (await teacher.page.getByText('Movable').boundingBox())?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 30)
        // The move must stick after the teacher's rebroadcast.
        await student.page.waitForTimeout(1200)
        const after = await student.page.getByText('Movable').boundingBox()
        const teacherAfter = await teacher.page.getByText('Movable').boundingBox()
        expect(Math.abs((after?.x ?? 0) - (teacherAfter?.x ?? 1000))).toBeLessThan(60)
        // Students can move, but not resize or rotate.
        await expect(student.page.getByLabel(/Resize from/)).toHaveCount(0)

        await teacher.context.close()
        await student.context.close()
    })
})

test.describe('teacher locking students', () => {
    // The overlay already swallows real pointer events; removing it proves the handlers refuse input on their own.
    const defeatOverlay = (page: Page) => page.addStyleTag({ content: '.student-lock-overlay { pointer-events: none !important; }' })

    test('a locked student cannot draw or pick tools, and unlocking restores them', async ({ browser }) => {
        const { teacher, students } = await startRoom(browser, ['Sam'])
        const [student] = students
        await selectTool(student.page, 'Pen')

        await setLock(teacher.page, /Lock student/)
        await expect(student.page.getByRole('status').filter({ hasText: 'paused interaction' })).toBeVisible()
        await expect(student.page.getByRole('button', { name: 'Pen', exact: true })).toBeDisabled()
        await defeatOverlay(student.page)

        await drag(student.page, [0.6, 0.6], [0.7, 0.7])
        await student.page.waitForTimeout(600)
        await expect(strokes(student.page)).toHaveCount(0)
        await expect(strokes(teacher.page)).toHaveCount(0)

        await setLock(teacher.page, /Unlock student/)
        await expect(student.page.getByRole('status').filter({ hasText: 'paused interaction' })).toHaveCount(0)
        await drag(student.page, [0.6, 0.6], [0.7, 0.7])
        await expect(strokes(teacher.page)).toHaveCount(1)

        await teacher.context.close()
        await student.context.close()
    })

    test('a locked student cannot move elements', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Lock move')
        await addNote(teacher.page, 'Pinned', [0.3, 0.3])
        const student = await openStudent(browser, await shareLesson(teacher.page))
        await expect(student.page.getByText('Pinned')).toBeVisible()
        await teacher.page.getByRole('button', { name: 'Close' }).click()

        await setLock(teacher.page, /Lock student/)
        await expect(student.page.getByRole('status').filter({ hasText: 'paused interaction' })).toBeVisible()
        await defeatOverlay(student.page)
        const before = await teacher.page.getByText('Pinned').boundingBox()
        await dragPixels(student.page, await center(student.page.getByText('Pinned')), 100, 60)
        await student.page.waitForTimeout(800)
        expect(await teacher.page.getByText('Pinned').boundingBox()).toEqual(before)

        await setLock(teacher.page, /Unlock student/)
        await expect(student.page.getByRole('status').filter({ hasText: 'paused interaction' })).toHaveCount(0)
        await dragPixels(student.page, await center(student.page.getByText('Pinned')), 100, 60)
        await expect.poll(async () => (await teacher.page.getByText('Pinned').boundingBox())?.x ?? 0).toBeGreaterThan((before?.x ?? 0) + 40)

        await teacher.context.close()
        await student.context.close()
    })

    test('locking mid-stroke discards the stroke in progress', async ({ browser }) => {
        const { teacher, students } = await startRoom(browser, ['Sam'])
        const [student] = students
        await selectTool(student.page, 'Pen')

        const start = await boardPoint(student.page, 0.3, 0.3)
        const end = await boardPoint(student.page, 0.5, 0.5)
        await student.page.mouse.move(start.x, start.y)
        await student.page.mouse.down()
        await student.page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 })
        await setLock(teacher.page, /Lock student/)
        await expect(student.page.getByRole('status').filter({ hasText: 'paused interaction' })).toBeVisible()
        await student.page.mouse.move(end.x, end.y, { steps: 4 })
        await student.page.mouse.up()

        await student.page.waitForTimeout(600)
        await expect(strokes(student.page)).toHaveCount(0)
        await expect(strokes(teacher.page)).toHaveCount(0)

        await teacher.context.close()
        await student.context.close()
    })

    test('locking one student leaves the others free to draw', async ({ browser }) => {
        const { teacher, students } = await startRoom(browser, ['Ann', 'Ben'])
        const [ann, ben] = students
        await selectTool(ann.page, 'Pen')
        await selectTool(ben.page, 'Pen')

        await teacher.page.getByRole('button', { name: /Students? connected/ }).click()
        await teacher.page.getByRole('button', { name: 'Lock Ann' }).click()
        await closeStudentMenu(teacher.page)
        await expect(ann.page.getByRole('status').filter({ hasText: 'paused interaction' })).toBeVisible()

        await drag(ann.page, [0.2, 0.3], [0.3, 0.4])
        await drag(ben.page, [0.5, 0.3], [0.6, 0.4])
        await expect(strokes(teacher.page)).toHaveCount(1)
        await ben.page.waitForTimeout(600)
        await expect(strokes(ann.page)).toHaveCount(1)
        await expect(strokes(ben.page)).toHaveCount(1)

        await teacher.context.close()
        await ann.context.close()
        await ben.context.close()
    })
})

test.describe('word grid on different screen sizes', () => {
    test('long grid text stays inside its cell for a student on a small screen', async ({ browser }) => {
        const teacher = await newTeacher(browser)
        await signUp(teacher.page)
        await createLesson(teacher.page, 'Grid fit')
        await teacher.page.getByRole('button', { name: 'Word grid' }).click()
        const point = await boardPoint(teacher.page, 0.2, 0.25)
        await teacher.page.mouse.click(point.x, point.y)
        await teacher.page.getByRole('textbox', { name: 'Grid cell 1' }).fill('Extraordinarily')
        await waitForSaved(teacher.page)
        const link = await shareLesson(teacher.page)

        const context = await browser.newContext({ viewport: { width: 520, height: 700 } })
        const page = await context.newPage()
        await page.goto(link)
        const cell = page.getByRole('textbox', { name: 'Grid cell 1' })
        await expect(cell).toHaveValue('Extraordinarily')
        const fits = await cell.evaluate((input: HTMLInputElement) => input.scrollWidth <= input.clientWidth)
        expect(fits).toBe(true)

        await teacher.context.close()
        await context.close()
    })
})
