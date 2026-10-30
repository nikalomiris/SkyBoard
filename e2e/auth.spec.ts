import { expect, test } from '@playwright/test'
import { PASSWORD, signIn, signUp, uniqueEmail } from './support/app'

test.describe('authentication', () => {
    test('submit is disabled until email and an 8+ character password are given', async ({ page }) => {
        await page.goto('/')
        const submit = page.getByRole('button', { name: 'Sign in' })
        await expect(submit).toBeDisabled()
        await page.getByLabel('Email').fill('a@test.local')
        await page.getByLabel('Password').fill('short')
        await expect(submit).toBeDisabled()
        await page.getByLabel('Password').fill(PASSWORD)
        await expect(submit).toBeEnabled()
    })

    test('toggles between sign-in and sign-up', async ({ page }) => {
        await page.goto('/')
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
        await page.getByRole('button', { name: /Create an account/ }).click()
        await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
        await page.getByRole('button', { name: /Already have an account/ }).click()
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    })

    test('rejects unknown credentials with an inline alert', async ({ page }) => {
        await signIn(page, uniqueEmail('nobody'))
        await expect(page.getByRole('alert')).toContainText(/invalid/i)
    })

    test('sign up, sign out, wrong password, then sign in again', async ({ page }) => {
        const email = await signUp(page)
        await page.getByRole('button', { name: 'Sign out' }).click()
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
        await signIn(page, email, 'wrong-password')
        await expect(page.getByRole('alert')).toBeVisible()
        await page.getByLabel('Password').fill(PASSWORD)
        await page.getByRole('button', { name: 'Sign in' }).click()
        await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeVisible()
    })

    test('duplicate sign-up does not expose a workspace', async ({ page }) => {
        const email = await signUp(page)
        await page.getByRole('button', { name: 'Sign out' }).click()
        await page.getByRole('button', { name: /Create an account/ }).click()
        await page.getByLabel('Email').fill(email)
        await page.getByLabel('Password').fill('another-password')
        await page.getByRole('button', { name: 'Create account' }).click()
        await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeHidden()
    })

    test('session survives a reload', async ({ page }) => {
        await signUp(page)
        await page.reload()
        await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeVisible()
    })
})
