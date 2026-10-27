import { expect, test } from '@playwright/test'
import { addNote, createLesson, newTeacher, openStudent, shareLesson, signUp } from './support/app'

test.describe('lesson sharing and live collaboration', () => {
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
