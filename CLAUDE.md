# Sign Mesh Maker

Web app that converts a 2D image/SVG into a multi-color 3D-printable STL sign.

## Start here
- **Build spec:** `docs/requirements.md` — full product/design spec, data model, algorithms, and the suggested implementation phases (§10). Follow that phase order unless told otherwise.
- **Setup status:** `docs/manual-setup.md` — all manual (browser/console) setup steps are complete as of the checklist in that file. Don't re-suggest doing them; if something in the app doesn't work, check whether it's actually one of the boxes there before assuming setup is incomplete.

## Key architectural constraints (do not deviate without asking)
- **No backend, ever, by design.** Firebase stays on the Spark (free) plan — no billing account is attached, and it should stay that way. This rules out Firebase Storage and Firebase Cloud Functions. Everything (inpainting, vectorization, mesh generation, STL export) runs client-side in the browser.
- **No Firebase Storage.** The SVG and a compressed thumbnail are stored as inline string fields on the Firestore `projects` document (see requirements §6), not as separate files. Keep the combined document under Firestore's 1 MiB limit — validate and warn before save.
- **Deploy target:** Cloudflare Workers (not classic Pages) via `wrangler.jsonc` at the repo root. Cloudflare's own Git-connected build handles building + deploying the frontend automatically on push — don't add a GitHub Actions job that also deploys the frontend, it would conflict. GitHub Actions here only deploys Firestore rules/indexes.
- Mesh generation is explicitly triggered by a button, not live/reactive to config changes (see requirements §4 step 5, §5.6).

## Environment
- Real Firebase config values live in `apps/web/.env.local` (gitignored, already populated — don't ask the user to re-paste them).
- Node is managed via `nvm`, not system/apt Node.
