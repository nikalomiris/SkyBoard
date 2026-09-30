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

## Data and sharing

Lessons, folders, and board items are stored in the current browser's local storage. The student link opens a read-only view, but it does not upload or transfer lesson data. As a result, a link to the deployed app does not make a teacher's saved boards available on another device. Cross-device sharing and collaboration require a shared backend and are not currently implemented.