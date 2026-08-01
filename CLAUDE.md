# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Sign Mesh Maker

Web app that converts a 2D image/SVG into a multi-color 3D-printable STL sign.

## Start here
- **Build spec:** `docs/requirements.md` — full product/design spec, data model, algorithms, and the suggested implementation phases (§10). Follow that phase order unless told otherwise.
- **Setup status:** `docs/manual-setup.md` — all manual (browser/console) setup steps are complete as of the checklist in that file. Don't re-suggest doing them; if something in the app doesn't work, check whether it's actually one of the boxes there before assuming setup is incomplete.
- **Current state:** scaffold only. `apps/web/src/App.tsx` is a placeholder with no routing, no auth, and no pipeline code. Dependencies are not installed yet — run `npm install` at the repo root first.

## UI work
Before building or reshaping any user-facing screen, invoke the `frontend-design:frontend-design` skill and follow it. This applies to new routes, new components, and visual reworks of existing ones — not to logic-only changes that leave the rendered output alone.

Two standing constraints it should work within, rather than override:
- Tailwind v4 with tokens in the `@theme` block of `apps/web/src/index.css`. New colors/spacing/radii go there as CSS variables so three.js can read the same values at runtime; don't hardcode hex in `className`.
- The app chrome stays deliberately restrained and low-chroma. The generated sign meshes are the only saturated thing on screen and must read accurately — a colorful UI would actively mislead about print colors. Spend the aesthetic risk on type, layout, and the marketing/empty-state surfaces, not on the editor chrome surrounding the 3D viewport.

## Commands

Run from the repo root (npm workspaces; each script delegates to `apps/web`):

```
npm install                      # required once — node_modules is not committed/present
npm run dev                      # Vite dev server on http://localhost:5173
npm run build                    # tsc -b && vite build → apps/web/dist
npm run typecheck                # tsc across all workspaces that define it
npm run deploy                   # manual wrangler deploy (needs `npx wrangler login` once)
npm --workspace=apps/web run preview   # serve the production build locally
```

Firestore rules/indexes (Firebase CLI is already authenticated on this machine):
```
firebase deploy --only firestore
```

Notes:
- `npm run lint` currently does nothing — no workspace defines a `lint` script and no linter is configured. If you add one, wire it into `apps/web/package.json` so the root script picks it up.
- There are no tests and no test runner yet.

## Key architectural constraints (do not deviate without asking)
- **No backend, ever, by design.** Firebase stays on the Spark (free) plan — no billing account is attached, and it should stay that way. This rules out Firebase Storage and Firebase Cloud Functions. Everything (inpainting, vectorization, mesh generation, STL export) runs client-side in the browser.
- **No Firebase Storage.** The SVG and a compressed thumbnail are stored as inline string fields on the Firestore `projects` document (see requirements §6), not as separate files. Keep the combined document under Firestore's 1 MiB limit — validate and warn before save.
- **Deploy target:** Cloudflare Workers (not classic Pages) via `wrangler.jsonc` at the repo root. Cloudflare's own Git-connected build handles building + deploying the frontend automatically on push — don't add a GitHub Actions job that also deploys the frontend, it would conflict. GitHub Actions here only deploys Firestore rules/indexes.
- Mesh generation is explicitly triggered by a button, not live/reactive to config changes (see requirements §4 step 5, §5.6).

## Structure & data flow

Monorepo via npm workspaces (`apps/*`, `packages/*`).

- `apps/web` — the entire application. React 18 + TypeScript + Vite.
- `packages/shared` — types only, consumed **directly as TypeScript source** (its `main`/`types` both point at `src/index.ts`; there is no build step). `Project` / `ProjectConfig` / `LayerConfig` here are the contract for the Firestore document shape and must stay in sync with requirements §6 and `firestore.rules`.
- Root-level Firebase config: `firestore.rules` (owner-only access keyed on `ownerUid`, deny-all fallback), `firestore.indexes.json` (composite index on `ownerUid` + `updatedAt` for the "My Projects" listing — any new project query needs a matching index here).

The client pipeline, which spans several libraries that are already declared as dependencies:

```
upload (PNG/JPG/SVG)
  → [raster only] mask + inpaint      konva/react-konva for the lasso UI; OpenCV.js WASM, lazy-loaded
  → [raster only] quantize + trace     k-means palette → imagetracerjs → one <path>/<g> per color
  → 3D config                          crop, mm dimensions, base/layer thickness, per-layer colors
  → generate mesh (button)             SVG paths → polygons → earcut → three.js extrusion per layer
  → preview + STL export               three.js viewer; STLExporter, download only, never persisted
  → save                               Firestore doc: svg + thumbnailDataUrl + config, inline
```

Two things that are easy to get backwards: the palette/vectorization preview *is* meant to re-run near-live (debounced) as the user tunes color count, while mesh generation is *not* — see requirements §5.2 vs §5.6. And heavy compute (OpenCV, triangulation, CSG) belongs in a Web Worker; there is no server to offload to.

## Repo artifacts that are dead / misleading
- There is deliberately no `functions/` directory and no `storage.rules` — both were deleted as leftovers from a pre-Spark-decision scaffold. Cloud Functions and Storage require Blaze and are out of scope (requirements §9). Don't recreate them.
- `README.md` and parts of `docs/requirements.md` say "Cloudflare Pages." The actual target is Cloudflare Workers with static assets (`wrangler.jsonc`); `docs/manual-setup.md` §7 has the accurate flow.
- `.firebaserc` aliases `sign-mesh-maker-staging` → project `sign-mesh-maker`; there is only one Firebase project, despite requirements §9 recommending a separate staging project.

## Environment
- Real Firebase config values live in `apps/web/.env.local` (gitignored, already populated — don't ask the user to re-paste them). All seven `VITE_FIREBASE_*` keys are present; read them via `import.meta.env`.
- **`.env.local` is gitignored, so it never reaches the Cloudflare build.** The five keys the app actually reads (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `MESSAGING_SENDER_ID`, `APP_ID`) must also be set as build environment variables in the Cloudflare project, or the deployed build has no Firebase config. These are not secrets — Firebase web config ships in every client bundle by design, and access is enforced by `firestore.rules` plus the authorized-domains list. Missing config now degrades gracefully (auth disabled, editor still works) rather than blanking the page; don't reintroduce a module-scope throw.
- Verify a deploy by loading the page in a browser and checking `#root` actually mounted. Grepping the bundle for strings is not sufficient — a bundle can contain every expected string and still throw before React renders.
- Node is managed via `nvm`, not system/apt Node.
- Live site: `signmaker.nataliepyre.com` (custom domain on the Cloudflare project). Adding any new deployment origin also requires adding it to Firebase Auth's authorized-domains list, or Google Sign-In fails there.
