import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'

// Reads VITE_* values from .env.test.local so the app talks to the local Supabase stack.
const env = loadEnv('test', process.cwd(), 'VITE_')
const port = 5199

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        // Keeps the first-run tutorials from covering the UI under test.
        storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${port}`, localStorage: [{ name: 'skyboard.tutorials.disabled', value: '1' }] }] },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort --mode test`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: !process.env.CI,
        env: env as Record<string, string>,
    },
})
