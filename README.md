# Sign Mesh Maker

Turn a 2D image or SVG into a multi-color, 3D-printable STL sign.

See `docs/requirements.md` for the full product/design spec — hand that file
to Claude Code as the primary build brief.

## Local dev

```
npm install
npm run dev
```

## Structure

- `apps/web` — React + three.js frontend (deployed to Cloudflare Pages)
- `functions` — Firebase Cloud Functions (server-side processing, only if the
  client-side vectorization/inpainting approach proves insufficient)
- `packages/shared` — shared TypeScript types (project/config schema)
- `firestore.rules`, `storage.rules`, `firebase.json`, `firestore.indexes.json`
  — Firebase project configuration

## Prerequisites (manual, one-time setup)

See `docs/manual-setup.md` for the steps that need to happen outside of the
codebase (Firebase project creation, Google auth provider, Cloudflare Pages
project, GitHub secrets, etc.) before Claude Code's changes can actually run
and deploy.
