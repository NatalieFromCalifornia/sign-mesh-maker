# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Sign Maker

Web app that converts an SVG into a multi-color 3D-printable STL sign.

## Start here
- **Build spec:** `docs/requirements.md` — full product/design spec, data model, algorithms, and the suggested implementation phases (§10). Follow that phase order unless told otherwise.
- **Setup status:** `docs/manual-setup.md` — all manual (browser/console) setup steps are complete as of the checklist in that file. Don't re-suggest doing them; if something in the app doesn't work, check whether it's actually one of the boxes there before assuming setup is incomplete.
- **Vector input only. Raster support was removed deliberately, not left unbuilt.** PNG/JPG/WebP upload, k-means quantization and `imagetracerjs` all existed and were deleted by product decision: traced output was too noisy for printable signs. Do not reintroduce raster input, tracing, or a color-count control without being asked. This also removes any need for the OpenCV.js inpainting in §10 phase 5 and §9.3 — that step only ever applied to raster art.
- **3MF colour lives in an `<m:colorgroup>`, not core `<basematerials>`.** Slicers read the Materials & Properties extension and ignore basematerials: a file carrying only the latter opens uniformly grey, and once parts are bound to slots without colours it silently takes whatever those slots were already set to. Both symptoms were reported from Orca before this was fixed.
- **`Metadata/model_settings.config` binds each part to a 1-based `extruder`.** Its `part` ids must equal the `<component objectid>`s in `3D/3dmodel.model`, or the assignments attach to nothing and the file looks untouched — a test pins this.
- **`Metadata/project_settings.config` declares one filament per layer, carrying its colour** — this is where slot colours are read from. Without it, parts land on slots that keep whatever colours were already configured. It carries *only* `filament_colour` and `filament_type`; a fuller config would start overriding machine settings belonging to whoever opens the file.
- **Slots are not capped.** Orca lets filaments be added freely, so all three lists — colorgroup, extruder assignments, filament array — are sized to the layer count. An earlier version clamped to an assumed printer capacity and threw away colours the slicer was willing to hold.
- **Exports are in printer space: +Z is thickness and the sign rests on z=0.** `buildMesh` produces that; the viewer applies the Y-up tilt itself via a pivot. Never rotate the group in `buildMesh`, and never read `matrixWorld` in an exporter — the group is parented under that pivot, so world matrices carry the tilt and the sign arrives in a slicer standing on its edge. `partsFromGroup` inverts the group's own world matrix for exactly this reason, and both STL and 3MF go through it so they cannot disagree.
- **Current state:** every §10 phase in scope is built — routing, Google auth, SVG upload, crop, per-layer recolouring and merging, stepped *and* flat mesh modes, the three.js preview, binary STL download, and project save/load. 3MF export replaces the per-colour STL zip §5.7 floats, which is why that stretch goal is not built and should not be.
- **Crop is stored as fractions of the artwork box**, not artwork units as §6 implies. The SVG is re-parsed on load, so any change to how bounds are derived would silently move a crop expressed absolutely.
- **Layer order is print order, and the user controls it.** Rows are listed **top of the stack first**, so the list reads the way the sign is stacked and up means up — listing lowest-first made the up arrow move a row down the screen. Only the display is reversed; every index stays in print order, lowest first. Rows carry up/down controls that move whole merged groups; the Editor keeps it as an `order` permutation over *source* indices, because `assigned` and `deleted` are keyed by source index and shuffling the layer array instead would mean remapping both in step. `keptSequence` is the one derived sequence the rows, the grouping and `sourceIndicesOf` all read — deriving them separately is exactly what makes a reorder recolour the wrong region. It persists as the array order of `config.layers` and is restored by matching `originalColor`, like the assignments and for the same reason.
- **A region nothing would show of is cut out of whatever buries it.** Reordering or merging can put a caption under the panel it sits on, and it would otherwise print in colour, sealed inside the sign. `revealBuriedLayers` subtracts it from everything above, so it reads as engraved. **Only regions that are *entirely* covered qualify, and that limit is what makes the rule safe** — a background is underneath everything and overlaps all of it, so cutting on any overlap would subtract it from every layer above and erase the sign. Backgrounds still show in their margins, so they are never buried.
  - **Judged per shape, not per layer.** Merging a caption into the background makes one layer that is overwhelmingly background and plainly not covered, so a per-layer test reports nothing wrong while the caption inside it disappears — which is exactly how it was first reported.
  - Each shape is clipped only against the cover rings its bounding box touches. Rings that miss it cannot remove any of it, so no answer changes, but it takes a glyph from being clipped against every other region on the sign. Skipping that made a 200-shape sign twice as slow to generate.
- **Layers are cut to be disjoint in both modes.** Each runs solid from the bed to its own height, so two that overlap fill one volume twice — and where they share an outline (a background and the border around its edge, which is most signs) that puts two outward-facing walls in one plane and z-fights along the whole edge. The taller layer already fills the overlap, so the union, and the print, are unchanged. A consequence worth knowing when writing tests: reordering changes which layer is taller but not how the artwork is divided between them, so triangle counts and overall depth stay put.
- **Flat mode is two heights, not one: the bottom layer *is* the base.** The slab already carries that layer's colour, so it gets no tile of its own; everything above reaches `baseMm + layerMm`. Giving the base a tile too stacked the background on top of itself. Folding another colour into the base is just merging it with the lowest layer — merged layers already share a colour and a height (§5.4), so there is no second mechanism.
- **Flat mode uses polygon offsetting, not CSG.** §5.5 specifies insetting each region by half the gap, which `clipper-lib` does robustly — a region thinner than the channel vanishes instead of folding into a self-intersecting outline that triangulates into a broken solid. §9.4 floats `three-bvh-csg`/`manifold-3d` as an alternative; they aren't needed and aren't installed.
- **Self-crossing outlines are repaired at parse time.** `repairShapes` runs every shape through a Clipper nonZero union in `parseSvgLayers`. Earcut is only defined on simple polygons and does not fail on a self-crossing one — it webs the crossings over with overlapping triangles, which arrives as a membrane across a glyph's concave notches. Text converted to paths produces these routinely where a font's strokes overlap at a join, and the file renders perfectly everywhere, so nothing warns you until the mesh is built. Repairing at parse rather than at mesh time keeps the previews, the crop and the extrusion looking at the same polygons.
- **Mesh generation waits for its button** (§5.6) — triangulation is the expensive step, and dimension fields get fiddled with continuously, so changing one marks the mesh stale rather than rebuilding.
  - **One carve-out:** merging, recolouring, deleting, reordering or resetting layers *does* rebuild automatically, once a mesh exists. Those change which layers exist and how tall the stack is, so the old mesh would contradict the layer list beside it. The effect depends on the `assigned`, `deleted` and `order` state alone; `generate` is held in a ref deliberately, because listing it would drag every config change back into the reactive path.
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
npm run test:rules               # 15 checks against the Firestore emulator; needs a JVM
npm run test:e2e                 # playwright — real browser, starts the dev server itself
npm run test:all                 # all three, in that order
npm --workspace=apps/web run test:watch
npm --workspace=apps/web run test -- svgLayers  # one vitest file by name
npx playwright test --project=chromium-hidpi    # just the display-scaling project
npx playwright test -g "STL"                    # single test by name
E2E_BASE_URL=https://signmaker.nataliepyre.com npx playwright test   # against the deploy
```

`npm run test:e2e` needs browsers once: `npx playwright install --with-deps chromium` (the `--with-deps` part needs sudo). All three suites run in CI via `.github/workflows/test.yml`, as separate jobs (`unit` also runs lint and typecheck; `rules` declares its own JDK; `e2e` uploads the Playwright report on failure). A red run is not a deploy gate — Cloudflare ships on push regardless, so treat it as a signal to revert.

**Which suite gets a new test.** Anything expressible as pure logic goes in vitest — it runs in seconds and needs no browser. Playwright is for what only exists in a real browser: canvas sizing, WebGL drawing, file upload, downloads. Every bug that reached a user so far had a natural home in one of them:
- decimal-percentage colors (`rgb(75.7%, …)` from Cairo/Inkscape) → `svgLayers.test.ts`
- number fields that couldn't be cleared → `NumberField.test.tsx`
- viewer blank on HiDPI → the `chromium-hidpi` Playwright project

The HiDPI bug was invisible for a while precisely because the harness ran at `deviceScaleFactor: 1`, which is why display scaling is now its own Playwright project rather than an option someone can quietly drop.

Notes:
- `npm run lint` runs ESLint over `apps/web`. It is deliberately narrow — behaviour is the test suites' job — and exists for what tests cannot see: hook dependency mistakes, dead code left by a refactor, and `any` slipping past `tsc`. `react-hooks/set-state-in-effect` is off on purpose; every hit in this codebase is an async load or a prop sync it cannot tell from the bug it targets, and a rule that is wrong every time teaches people to ignore it.
- **Routes are lazy-loaded and `three`/`firebase` are separate chunks.** `/login` transfers 630 KB against the editor's 1,296 KB; before splitting, every page paid the full amount. The editor is unchanged because it genuinely needs three — deferring that too would mean dynamically importing the whole geometry pipeline, which is a real refactor of well-tested code for a moderate win.

## Key architectural constraints (do not deviate without asking)
- **No backend, ever, by design.** Firebase stays on the Spark (free) plan — no billing account is attached, and it should stay that way. This rules out Firebase Storage and Firebase Cloud Functions. Everything (SVG parsing, mesh generation, STL export) runs client-side in the browser.
- **No Firebase Storage.** The SVG and a compressed thumbnail are stored as inline string fields on the Firestore `projects` document (see requirements §6), not as separate files. Keep the combined document under Firestore's 1 MiB limit — validate and warn before save.
- **Deploy target:** Cloudflare Workers (not classic Pages) via `wrangler.jsonc` at the repo root. Cloudflare's own Git-connected build handles building + deploying the frontend automatically on push — don't add a GitHub Actions job that also deploys the frontend, it would conflict. GitHub Actions here only deploys Firestore rules/indexes.
- Mesh generation is explicitly triggered by a button, not live/reactive to config changes (see requirements §4 step 5, §5.6).

## Structure & data flow

Monorepo via npm workspaces (`apps/*`, `packages/*`).

- `apps/web` — the entire application. React 18 + TypeScript + Vite. Every pipeline stage is a pure module in `src/lib` (`svgLayers` → `buildMesh`/`offset` → `export3mf`/`exportStl`, plus `projects`/`thumbnail`/`firebase`) with a `.test.ts` beside it; `src/routes/Editor.tsx` owns all of the editor's state and is the only place they are wired together. New pipeline logic belongs in a `lib` module with a vitest file, not in the component.
- `packages/shared` — types only, consumed **directly as TypeScript source** (its `main`/`types` both point at `src/index.ts`; there is no build step). `Project` / `ProjectConfig` / `LayerConfig` here are the contract for the Firestore document shape and must stay in sync with requirements §6 and `firestore.rules`.
- Root-level Firebase config: `firestore.rules` (owner-only access keyed on `ownerUid`, deny-all fallback), `firestore.indexes.json` (composite index on `ownerUid` + `updatedAt` for the projects listing — any new project query needs a matching index here, or it fails at runtime rather than at build time).

**Firestore rules and indexes are deployed by `.github/workflows/deploy.yml`, which is path-filtered.** Those files rarely change, so the workflow rarely runs — it never ran successfully at all until the projects list shipped, which is why the composite index was missing and every listing failed. It now also accepts `workflow_dispatch`. To check what is actually live, don't infer it from the repo: run `firebase firestore:indexes --project sign-mesh-maker`. Deploying by hand is `firebase deploy --only firestore` and is pre-authorized by `docs/manual-setup.md` §6.

**Security.** `firestore.rules` is the only enforcement boundary — the app is a static bundle and anyone with a token can write directly, so client-side checks constrain only the honest client. Rules validate document shape, field types and sizes, and require `request.resource.data.ownerUid == request.auth.uid` on update as well as `resource.data.ownerUid`: testing only the latter proves the writer owns the document *as it stands* and says nothing about what they are writing, which let an owner push a document — and its thumbnail — into someone else's project list. `npm run test:rules` runs 15 checks against the emulator, including that one; it needs a JVM. Thumbnails are re-validated as `data:image/*` on read too, since they land in an `<img src>`. Response headers (CSP, frame-ancestors, nosniff) live in `apps/web/public/_headers`, which Cloudflare serves from the assets directory. Its `connect-src` is an allowlist of Firebase hosts and nothing else, so any new outbound origin has to be added there or it is blocked in production only — the dev server does not enforce it.

**Persistence.** `packages/shared` is the stored schema and deliberately narrower than requirements §6: no cached height (derived from the SVG, so a copy can only drift), and no `id`/`order`/`mergedWith` on layers — order is the array index and merging *is* a shared `assignedColor`. `cropRect`, `flatMode` and `flatGapMm` *are* stored, and the latter two are optional so projects saved before flat mode existed still load as stepped. The array order of `config.layers` is the print order, deleted layers parked at the end. Assignments and stacking both restore by matching `originalColor`, not by index, so a re-parse that reorders layers can't recolour the wrong regions. Saves are refused above `SAFE_DOC_BUDGET` (900 KB) rather than at Firestore's 1 MiB, because the estimate omits field names, indexes and timestamps — hitting the real ceiling would surface a server error the user can't act on.

The client pipeline. Dependencies are deliberately minimal — `konva`/`react-konva` (lasso UI for inpainting) and the standalone `earcut` were removed along with raster support; three ships its own Earcut:

```
upload (SVG)                          fills grouped by colour, one layer each, document order
  → crop (optional)                   fractions of the artwork box; clipped before anything else
  → layer config                      recolour, delete, merge (same colour = one layer, §5.4)
  → dimensions                        mm width, base thickness, layer step
  → generate mesh (button)            shapes → earcut → three.js extrusion per layer
       flat mode: layers cut to be disjoint, inset by gap/2, seated on a unioned slab
  → preview + export                  three.js viewer; 3MF (colours, one build item) or plain STL
  → save                              Firestore doc: svg + JPEG thumbnail + config, all inline
```

Mesh generation is the only expensive step left, and it stays behind its button (§5.6). If triangulation or CSG ever janks the UI, move it to a Web Worker — there is no server to offload to.

## Repo artifacts that are dead / misleading
- There is deliberately no `functions/` directory and no `storage.rules` — both were deleted as leftovers from a pre-Spark-decision scaffold. Cloud Functions and Storage require Blaze and are out of scope (requirements §9). Don't recreate them.
- Parts of `docs/requirements.md` say "Cloudflare Pages." The actual target is Cloudflare Workers with static assets (`wrangler.jsonc`); `docs/manual-setup.md` §7 has the accurate flow, and the README is corrected.
- `.firebaserc` aliases `sign-mesh-maker-staging` → project `sign-mesh-maker`; there is only one Firebase project, despite requirements §9 recommending a separate staging project.

## Environment
- Real Firebase config values live in `apps/web/.env.local` (gitignored, already populated — don't ask the user to re-paste them). All seven `VITE_FIREBASE_*` keys are present; read them via `import.meta.env`.
- **`apps/web/.env` is committed on purpose** and carries the five keys the app reads (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `MESSAGING_SENDER_ID`, `APP_ID`). `.gitignore` ignores `.env` globally and then un-ignores that one path — don't "fix" the exception. These are not secrets: Firebase web config ships in every client bundle by design, and access is enforced by `firestore.rules` plus the authorized-domains list. They live in the repo rather than the Cloudflare dashboard because this Worker serves static assets only, which blocks dashboard variable settings — and a build input that exists only in a dashboard is invisible, which blanked production once. Don't send anyone to set Cloudflare build variables for these.
- `.env.local` is still gitignored and still wins locally, so per-developer overrides work. Missing config degrades gracefully (auth disabled, editor still works) rather than blanking the page; don't reintroduce a module-scope throw.
- **The dev server polls for file changes** (`usePolling` in `vite.config.ts`). The repo lives on `/mnt/f`, a Windows drive mounted into WSL, and inotify doesn't cross that boundary — without polling the dev server silently serves stale modules and edits appear to do nothing.
- Verify a deploy by loading the page in a browser and checking `#root` actually mounted. Grepping the bundle for strings is not sufficient — a bundle can contain every expected string and still throw before React renders.
- Node is managed via `nvm`, not system/apt Node.
- Live site: `signmaker.nataliepyre.com` (custom domain on the Cloudflare project). Adding any new deployment origin also requires adding it to Firebase Auth's authorized-domains list, or Google Sign-In fails there.
