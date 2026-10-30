import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'password123'

export function uniqueEmail(prefix = 'e2e') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
}

export async function signUp(page: Page, email = uniqueEmail()) {
    await page.goto('/')
    await page.getByRole('button', { name: /Create an account/ }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeVisible()
    return email
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
    await page.goto('/')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function createLesson(page: Page, title: string) {
    await page.getByRole('button', { name: /Start with a blank lesson|New lesson/ }).first().click()
    await page.getByLabel('Lesson name').fill(title)
    await page.getByRole('button', { name: 'Create lesson' }).click()
    await expect(page.locator('.page-paper')).toBeVisible()
}

// The app debounces cloud saves by 450ms, so wait past it before asserting the indicator.
export async function waitForSaved(page: Page) {
    await page.waitForTimeout(700)
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveAttribute('title', 'All changes saved')
}

// Pointer position inside the board, as a fraction of its size.
export async function boardPoint(page: Page, fx: number, fy: number) {
    const box = await page.locator('.page-paper').boundingBox()
    if (!box) throw new Error('Board is not visible')
    return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

export async function drawStroke(page: Page, tool: 'Pen' | 'Brush' | 'Highlighter', from: [number, number], to: [number, number]) {
    await page.getByRole('button', { name: tool, exact: true }).click()
    const start = await boardPoint(page, ...from)
    const end = await boardPoint(page, ...to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
}

export async function addNote(page: Page, text: string, at: [number, number]) {
    await page.getByRole('button', { name: 'Post-it' }).click()
    const point = await boardPoint(page, ...at)
    await page.mouse.click(point.x, point.y)
    await page.getByRole('textbox', { name: 'Note text' }).fill(text)
    await page.getByRole('button', { name: 'Add note' }).click()
}

import type { Browser, BrowserContext } from '@playwright/test'

export async function newTeacher(browser: Browser) {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    return { context, page: await context.newPage() }
}

// Creates a saved lesson with a note, then starts a share and returns the student link.
export async function shareLesson(page: Page, options: { name?: string; requireApproval?: boolean } = {}) {
    const { name = 'Sam', requireApproval = false } = options
    await waitForSaved(page)
    await page.getByRole('button', { name: 'Share lesson' }).click()
    await expect(page.getByText(/Lesson room is live/)).toBeVisible()
    const approval = page.getByRole('checkbox', { name: /Ask me before/ })
    if (requireApproval) await approval.check()
    else await approval.uncheck()
    await page.getByRole('textbox', { name: 'Student name' }).fill(name)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const row = page.locator('.invite-row', { hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Copy link' }).click()
    return page.evaluate(() => navigator.clipboard.readText())
}

export async function openStudent(browser: Browser, link: string) {
    const context: BrowserContext = await browser.newContext()
    const page = await context.newPage()
    await page.goto(link)
    return { context, page }
}
