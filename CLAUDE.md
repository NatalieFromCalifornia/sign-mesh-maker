# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Sign Maker

Web app that converts an SVG into a multi-color 3D-printable STL sign.

## Start here
- **Build spec:** `docs/requirements.md` — full product/design spec, data model, algorithms, and the suggested implementation phases (§10). Follow that phase order unless told otherwise.
- **Setup status:** `docs/manual-setup.md` — all manual (browser/console) setup steps are complete as of the checklist in that file. Don't re-suggest doing them; if something in the app doesn't work, check whether it's actually one of the boxes there before assuming setup is incomplete.
- **Vector input only. Raster support was removed deliberately, not left unbuilt.** PNG/JPG/WebP upload, k-means quantization and `imagetracerjs` all existed and were deleted by product decision: traced output was too noisy for printable signs. Do not reintroduce raster input, tracing, or a color-count control without being asked. This also removes any need for the OpenCV.js inpainting in §10 phase 5 and §9.3 — that step only ever applied to raster art.
- **Current state:** routing, Google auth, SVG upload, per-layer recolouring and merging, stepped *and* flat mesh modes, the three.js preview, binary STL download, and project save/load all work end to end. Still to build: crop (§5.3).
- **Flat mode uses polygon offsetting, not CSG.** §5.5 specifies insetting each region by half the gap, which `clipper-lib` does robustly — a region thinner than the channel vanishes instead of folding into a self-intersecting outline that triangulates into a broken solid. §9.4 floats `three-bvh-csg`/`manifold-3d` as an alternative; they aren't needed and aren't installed.
- **Mesh generation waits for its button** (§5.6) — triangulation is the expensive step, and dimension fields get fiddled with continuously, so changing one marks the mesh stale rather than rebuilding.
  - **One carve-out:** merging, recolouring or resetting layers *does* rebuild automatically, once a mesh exists. Those change which layers exist and how tall the stack is, so the old mesh would contradict the layer list beside it. It fires on the `assigned` array alone, deliberately not on `generate`'s identity — depending on that would drag config changes back into the reactive path.
- **The stats line describes the mesh that was built**, from `stats` captured at generation time, never live config. Reporting `config.widthMm` there claimed dimensions the on-screen object didn't have.

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

Tests:
```
npm run test                     # vitest, jsdom — pure logic and components, seconds
npm run test:e2e                 # playwright — real browser, starts the dev server itself
npm run test:all                 # both
npm --workspace=apps/web run test:watch
npx playwright test --project=chromium-hidpi    # just the display-scaling project
npx playwright test -g "STL"                    # single test by name
E2E_BASE_URL=https://signmaker.nataliepyre.com npx playwright test   # against the deploy
```

`npm run test:e2e` needs browsers once: `npx playwright install --with-deps chromium` (the `--with-deps` part needs sudo). Both suites run in CI via `.github/workflows/test.yml`.

**Which suite gets a new test.** Anything expressible as pure logic goes in vitest — it runs in seconds and needs no browser. Playwright is for what only exists in a real browser: canvas sizing, WebGL drawing, file upload, downloads. Every bug that reached a user so far had a natural home in one of them:
- decimal-percentage colors (`rgb(75.7%, …)` from Cairo/Inkscape) → `svgLayers.test.ts`
- number fields that couldn't be cleared → `NumberField.test.tsx`
- viewer blank on HiDPI → the `chromium-hidpi` Playwright project

The HiDPI bug was invisible for a while precisely because the harness ran at `deviceScaleFactor: 1`, which is why display scaling is now its own Playwright project rather than an option someone can quietly drop.

Notes:
- `npm run lint` currently does nothing — no workspace defines a `lint` script and no linter is configured. If you add one, wire it into `apps/web/package.json` so the root script picks it up.

## Key architectural constraints (do not deviate without asking)
- **No backend, ever, by design.** Firebase stays on the Spark (free) plan — no billing account is attached, and it should stay that way. This rules out Firebase Storage and Firebase Cloud Functions. Everything (SVG parsing, mesh generation, STL export) runs client-side in the browser.
- **No Firebase Storage.** The SVG and a compressed thumbnail are stored as inline string fields on the Firestore `projects` document (see requirements §6), not as separate files. Keep the combined document under Firestore's 1 MiB limit — validate and warn before save.
- **Deploy target:** Cloudflare Workers (not classic Pages) via `wrangler.jsonc` at the repo root. Cloudflare's own Git-connected build handles building + deploying the frontend automatically on push — don't add a GitHub Actions job that also deploys the frontend, it would conflict. GitHub Actions here only deploys Firestore rules/indexes.
- Mesh generation is explicitly triggered by a button, not live/reactive to config changes (see requirements §4 step 5, §5.6).

## Structure & data flow

Monorepo via npm workspaces (`apps/*`, `packages/*`).

- `apps/web` — the entire application. React 18 + TypeScript + Vite.
- `packages/shared` — types only, consumed **directly as TypeScript source** (its `main`/`types` both point at `src/index.ts`; there is no build step). `Project` / `ProjectConfig` / `LayerConfig` here are the contract for the Firestore document shape and must stay in sync with requirements §6 and `firestore.rules`.
- Root-level Firebase config: `firestore.rules` (owner-only access keyed on `ownerUid`, deny-all fallback), `firestore.indexes.json` (composite index on `ownerUid` + `updatedAt` for the projects listing — any new project query needs a matching index here, or it fails at runtime rather than at build time).

**Firestore rules and indexes are deployed by `.github/workflows/deploy.yml`, which is path-filtered.** Those files rarely change, so the workflow rarely runs — it never ran successfully at all until the projects list shipped, which is why the composite index was missing and every listing failed. It now also accepts `workflow_dispatch`. To check what is actually live, don't infer it from the repo: run `firebase firestore:indexes --project sign-mesh-maker`. Deploying by hand is `firebase deploy --only firestore` and is pre-authorized by `docs/manual-setup.md` §6.

**Persistence.** `packages/shared` is the stored schema and deliberately narrower than requirements §6: no `cropRect`/`flatMode`/`flatGapMm` (not built), no cached height (derived from the SVG, so a copy can only drift), and no `id`/`order`/`mergedWith` on layers — order is the array index and merging *is* a shared `assignedColor`. Assignments restore by matching `originalColor`, not by index, so a re-parse that reorders layers can't recolour the wrong regions. Saves are refused above `SAFE_DOC_BUDGET` (900 KB) rather than at Firestore's 1 MiB, because the estimate omits field names, indexes and timestamps — hitting the real ceiling would surface a server error the user can't act on.

The client pipeline. Dependencies are deliberately minimal — `konva`/`react-konva` (lasso UI for inpainting) and the standalone `earcut` were removed along with raster support; three ships its own Earcut:

```
upload (SVG)                          fills grouped by colour, one layer each, document order
  → layer config                      recolour, merge (same colour = one layer, §5.4)
  → dimensions                        mm width, base thickness, layer step
  → generate mesh (button)            shapes → earcut → three.js extrusion per layer
       flat mode: layers cut to be disjoint, inset by gap/2, seated on a unioned slab
  → preview + STL export              three.js viewer; STLExporter, download only, never persisted
  → save                              Firestore doc: svg + JPEG thumbnail + config, all inline
```

Mesh generation is the only expensive step left, and it stays behind its button (§5.6). If triangulation or CSG ever janks the UI, move it to a Web Worker — there is no server to offload to.

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
