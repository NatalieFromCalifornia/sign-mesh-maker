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

- `apps/web` — React + three.js frontend (deployed to Cloudflare Pages). This
  is the entire app — there is no backend. Vectorization, inpainting, and mesh
  generation all run client-side in the browser.
- `packages/shared` — shared TypeScript types (project/config schema)
- `firestore.rules`, `firebase.json`, `firestore.indexes.json` — Firebase
  project configuration (Auth + Firestore only, Spark/free plan — no billing
  account is ever attached; see `docs/requirements.md` §3)
- `wrangler.jsonc` — Cloudflare deploy config; defines the assets directory
  Cloudflare uploads (`apps/web/dist`) since Cloudflare's dashboard no longer
  has a separate output-directory field

## Prerequisites (manual, one-time setup)

See `docs/manual-setup.md` for the steps that need to happen outside of the
codebase (Firebase project creation, Google auth provider, Cloudflare Pages
project, GitHub secrets, etc.) before Claude Code's changes can actually run
and deploy.
