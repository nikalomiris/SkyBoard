# SkyBoard Copilot Instructions

## Commands

- Requires Node.js 18+.
- `npm install` installs dependencies.
- `npm run dev` starts the Vite development server; use `npm run dev -- --host` to expose it on the local network.
- `npx tsc -b` type-checks without producing a build.
- `npm run build` type-checks and creates the production bundle in `dist/`.
- `npm run preview` serves the production bundle.
- `npx supabase db push` applies `supabase/migrations/` to the linked Supabase project.
- `npm test` runs the Vitest unit tests (`src/**/*.test.ts`); `npx vitest run src/lib/liveSync.test.ts` runs a single file. `npm run test:e2e` runs Playwright against a local Supabase stack (requires Docker).
- Teacher/student live sync logic (diffing, merging, pending-edit reconciliation) lives in `src/lib/liveSync.ts`; student edits are sent as `{ pageIndex, upserts, removed }` and merged by item id. Keep it covered by `liveSync.test.ts` and `e2e/collaboration.spec.ts`.

## Architecture

- This is a static Vite/React SPA. `src/main.tsx` mounts `App`, while `src/App.tsx` owns app-wide authentication, teacher/student mode, workspace state, lesson/page navigation, sharing, dialogs, and persistence. Focused UI lives in components such as `BlendingBoard`, `AuthScreen`, and `ProfileSettings`.
- Supabase is optional at runtime: `src/lib/supabase.ts` creates a client only when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set. Keep the browser-local workspace fallback working when that client is unavailable.
- The workspace repository converts relational Supabase rows to the UI model and back. It loads profiles, students, folders, lessons, and pages; folders are represented in UI state by paths separated with ` / `. Page content and backgrounds are keyed in memory as `${lessonId}:${pageIndex}`.
- Board page content uses the `BoardItem` discriminated union. Preserve all supported item types (strokes, text, notes, shapes, grids, images, and PDFs) when transforming, copying, saving, or rendering board data.
- Cloud workspace updates are serialized through the save queue and persisted as a full workspace snapshot. Do not add independent persistence paths that can bypass or race that queue.
- `?view=student` selects the student experience. Authenticated teacher workspace loading, token-based shared-lesson access, and live lesson collaboration are separate flows. Realtime collaboration uses the `lesson-live:${shareSessionId}` channel and broadcasts state, drafts, cursors, blend state, and locks.
- The blending board is transient scratch state and resets when the open lesson changes; it is not part of normal workspace persistence.

## Supabase conventions

- Apply schema changes as new sortable migrations named `YYYYMMDDHHMMSS_description.sql`; evolve existing RPC contracts with `create or replace function` when appropriate.
- Data is owner-scoped. Preserve `owner_id` relationships, composite owner foreign keys, and RLS policies based on `auth.uid()`; do not introduce client-side access paths around RLS.
- Public/student lesson access goes through the existing security-definer RPCs rather than direct table reads. Security-definer functions set `search_path = ''`, validate authentication and ownership where required, and grant only the needed execution roles.
- `save_lesson_pages(jsonb)` is the atomic page-save boundary. It validates the supplied pages, avoids ordering collisions, deletes omitted pages, and upserts the replacement set. Route page persistence through it rather than writing `lesson_pages` piecemeal.
- Private lesson assets are stored under `ownerId/lessonId/pageId/itemId`; profile avatars are likewise stored below the user ID. Keep matching storage policies, metadata writes, and signed-URL retrieval for private assets.
- Local configuration belongs in `.env.local` (copied from `.env.example`). Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are browser-safe; never expose a service-role key through a `VITE_` variable.

## UI conventions

- Use functional React components. Keep cross-component/workspace state in `App`; keep component-specific interaction and form state local.
- Reuse the established CSS classes in `src/style.css` and Lucide icons from `lucide-react`.
- Modal dialogs use the existing `modal-scrim` pattern with `aria-modal="true"`. Forms use controlled inputs, busy/error/success state, disabled submissions while pending, and inline `role="alert"` or `role="status"` feedback.
- Toolbar and pointer-driven controls provide `aria-label` and `title`; mutually exclusive controls use the existing radio semantics. Student/read-only mode must suppress edit handlers, not merely hide editing affordances.

## Branching strategy

- `main` is production-only; it changes only through a release merge from `develop`.
- `develop` is the integration branch and runs ahead of `main` between releases.
- Create all `feature/*`, `bugfix/*`, and similar work branches from `develop`, and open their pull requests against `develop`.
- A production release is a merge (PR) from `develop` into `main`.
