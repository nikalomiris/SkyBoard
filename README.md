# SkyBoard

SkyBoard is a page-based whiteboard for building and teaching lessons. It includes drawing tools, text, shapes, word grids, notes, and image or PDF elements, with a read-only student view.

## Run locally

Requirements: Node.js 18 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite in your terminal (by default http://localhost:5173/).

## Common commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies (run again after pulling dependency changes) |
| `npm run dev` | Start the dev server with hot reload |
| `npm run dev -- --host` | Start the dev server and expose it on your network (e.g. to test on another device) |
| `npx tsc -b` | Type-check the project without building |
| `npm run build` | Type-check and create the production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npx supabase db push` | Apply database migrations to the linked Supabase project |

Student view: add `?view=student` to the app URL.

## Testing

Install dependencies with `npm install`. End-to-end tests use Playwright's Chromium browser; install it once with:

```sh
npx playwright install chromium
```

Unit tests run in jsdom and leave Supabase unconfigured, so they exercise the browser-local fallback:

| Command | Purpose |
| --- | --- |
| `npm run test:unit` | Run unit tests |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:coverage` | Run unit tests and write an HTML coverage report to `coverage/` |
| `npm run test:e2e` | Run Playwright end-to-end tests in Chromium |
| `npm run test:db` | Run pgTAP database tests with `supabase test db` |
| `npm run test:all` | Type-check, then run unit and end-to-end tests (does not include database tests) |

End-to-end and database tests use the **local Supabase stack**. Start Docker Desktop, then run:

```sh
npx supabase start
```

Copy the local API URL and publishable key shown by the command into `.env.test.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
```

The test environment reads these values to connect to local Supabase; do not put production credentials in `.env.test.local`. The Playwright config starts Vite on port 5199 for the tests. Run `npm run test:e2e` or `npm run test:db` with the local Supabase stack running. The e2e suite creates disposable local accounts and tests authentication, lesson editing and persistence, sharing, and live collaboration. Database tests roll back their fixtures.

## Build

```sh
npm run build
npm run preview
```

The production site is generated in `dist/`.

## Deploy

SkyBoard is a static Vite app and can be hosted on services such as Vercel or Netlify. Connect the GitHub repository and configure:

- Build command: `npm run build`
- Output directory: `dist`

The host will provide a public URL that can be opened on other devices.

## Supabase foundation

The frontend remains a static Vite app hosted on Vercel. Supabase is the planned managed backend for authentication, the database, private asset storage, and lesson sessions.

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's API settings. These are browser-safe client values; never put a service-role key in a `VITE_` variable.
3. Install or run the Supabase CLI, link this repository to the project with `npx supabase link --project-ref <project-ref>`, then apply the schema with `npx supabase db push`.
4. In Supabase Authentication settings, enable email/password. Set the local and Vercel app URLs as the Site URL and allowed redirect URLs so email confirmation and password-reset links return to SkyBoard.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Vercel project's Preview and Production environment variables, then redeploy.

The initial migration creates therapist-owned profiles, students, nested folders, lessons, ordered pages with JSON board elements, asset metadata, private storage policies, and lesson-session records. Sessions have a one-hour therapist-inactivity expiry; `end_lesson_session` supports immediate revocation.

**Current status:** when Supabase environment variables are configured, therapist views use Supabase email/password sign-in, account creation, session restoration, and sign-out. Profile settings support display-name changes, private avatar uploads, and password updates. Student roots, nested folders, lessons, pages, tags, board elements, and lesson assets are loaded and saved in Supabase. Existing browser-local lessons are not imported; new cloud workspaces start with the sample lessons. Run `npx supabase db push` after pulling schema changes; starter seeding is atomic and recoverable.