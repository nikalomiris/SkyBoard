# SkyBoard

SkyBoard is a page-based whiteboard for building and teaching lessons. It includes drawing tools, text, shapes, word grids, notes, and image or PDF elements, with a read-only student view.

## Run locally

Requirements: Node.js 18 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite in your terminal.

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

**Current status:** when Supabase environment variables are configured, therapist views use Supabase email/password sign-in, account creation, session restoration, and sign-out. Student roots, nested folders, lessons, pages, tags, board elements, and uploaded assets are loaded and saved in Supabase. Existing browser-local lessons are not imported; new cloud workspaces start with the sample lessons. Run `npx supabase db push` after pulling schema changes; the latest migration makes starter seeding atomic and recoverable. Student share-token creation/validation and cross-device session updates are not wired up yet, and page background persistence is still pending.