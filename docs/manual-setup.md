# Manual Setup — Things Claude Code Can't Do For You

Claude Code operates on your local filesystem/terminal. It can write code, run
CLIs once you're authenticated, and even run some CLI commands *for* you — but
anything that requires an interactive browser login, clicking through a
console UI, or entering payment details has to be done by you, by hand, in a
browser. This is the ordered list of those steps.

**This project intentionally stays on Firebase's Spark (free) plan for the
whole build — no billing account is ever attached to Firebase.** That means
no Firebase Storage and no Cloud Functions (both now require the pay-as-you-go
Blaze plan); everything runs as Auth + Firestore only, with all processing
done client-side in the browser. See `docs/requirements.md` §3 for why.

Do steps 1–5 **before** you point Claude Code at the repo, since the codebase
needs real project IDs/config values to run against. Steps 6+ happen after
Claude Code has built enough to deploy.

---

## Status

- [x] 1. Accounts created
- [x] 2. GitHub repository created
- [x] 3. Firebase project created (Spark plan)
- [x] 4. Google Sign-In enabled
- [x] 5. Firestore database created
- [x] 6. Firebase CLI installed & authenticated
- [x] 7. Cloudflare project created
- [x] 8. Custom domain attached (`signmaker.nataliepyre.com`)
- [x] 9. GitHub Secrets added (`FIREBASE_TOKEN`, `FIREBASE_PROJECT_ID`)

All steps below are complete — this file is kept as reference for what was
done and how, not as an open task list. If something in the app misbehaves,
check whether it's actually one of these steps (e.g. an authorized domain
that didn't get added) before assuming it's a code bug.

---

## 1. Create accounts (if you don't already have them)
- A Google account (used for both Firebase and Google Sign-In).
- A GitHub account.
- A Cloudflare account.

## 2. Create the GitHub repository
1. Go to github.com → **New repository** → name it (e.g. `sign-mesh-maker`) → Create.
2. Locally: `git init`, `git remote add origin <your-repo-url>`, then push this scaffold as the first commit.
   - Claude Code *can* run these git commands for you once you tell it the remote URL — it just can't create the GitHub repo itself or log you into GitHub the first time. If you have the `gh` CLI, run `gh auth login` yourself (interactive device-code flow) once; after that Claude Code can use `gh` on your behalf.

## 3. Create the Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. Name it, disable/enable Google Analytics as you prefer, create the project.
3. Under **Project settings → General**, add a **Web app** — this gives you the `firebaseConfig` object (`apiKey`, `authDomain`, `projectId`, `messagingSenderId`, `appId`, etc.). You'll paste these into the web app's environment variables (e.g. `apps/web/.env.local`) — Claude Code can wire up the code to *read* them, but you have to supply the actual values since they come from a page only you can access.
4. Confirm the project stays on **Spark** — this is the default for a new project, so as long as you skip any "upgrade to Blaze" prompts, no billing/card is ever required.

## 4. Enable Google Sign-In
1. In the Firebase console: **Build → Authentication → Sign-in method**.
2. Enable the **Google** provider, set a support email.
3. Under **Authentication → Settings → Authorized domains**, this list needs to include:
   - `localhost` (already there by default, for local dev)
   - your Cloudflare Pages `*.pages.dev` domain, once step 8 exists
   - your final custom domain, once DNS is set up (step 9)
   - You'll come back to add the last two after they exist — Claude Code can remind you, but can't click this toggle for you.

## 5. Create the Firestore database
1. Firebase console → **Build → Firestore Database → Create database**.
2. Choose a region (pick one close to you; it can't be changed later without migrating).
3. Start in **production mode** (the `firestore.rules` file in this repo will be deployed over it — see step 6). Firestore in production mode is fully usable on Spark; nothing here requires billing.

## 6. Install and authenticate the Firebase CLI (one-time, interactive)
```
npm install -g firebase-tools
firebase login          # opens a browser, you log in interactively
firebase use --add      # link this repo to the Firebase project you created
```
After this one-time interactive login, Claude Code *can* run `firebase deploy --only firestore` on your behalf (deploying rules/indexes), since the CLI will already be authenticated on your machine. This deploy step is free on Spark.

## 7. Create the Cloudflare project
Cloudflare has merged Pages into its unified **Workers** platform. The dashboard flow is now: **Compute (Workers & Pages) → Create → Import a repository**, and it deploys via Wrangler rather than a "build output directory" field.
1. Authorize Cloudflare's GitHub App and pick the repo you created in step 2 (this GitHub↔Cloudflare OAuth authorization is an interactive click-through only you can do).
2. Project name: `sign-mesh-maker` (must match the `name` field in `wrangler.jsonc` at the repo root — the scaffold already sets this).
3. Build command: `npm run build --workspace=apps/web`
4. Deploy command: leave as the default `npx wrangler deploy` — it reads `wrangler.jsonc`'s `assets.directory` to know what to upload, which is why there's no separate output-directory field anymore.
5. Click **Deploy**. This creates your `*.workers.dev` URL immediately, and — importantly — this dashboard-connected build now handles building *and* deploying automatically on every push by itself. You don't need the GitHub Actions workflow for the frontend at all; it's scaffolded here only to keep Firestore rules in sync (see `.github/workflows/deploy.yml`).

## 8. Point your custom domain at your Cloudflare project
1. If the domain isn't already on Cloudflare: **Add a site** in the Cloudflare dashboard and update your registrar's nameservers to Cloudflare's (this nameserver change happens at your domain registrar, outside of Cloudflare/Claude Code entirely, and can take anywhere from minutes to ~24h to propagate).
2. In the project → **Settings → Domains & Routes → Add**, enter your domain/subdomain. Cloudflare auto-creates the DNS record if the zone is already on Cloudflare.
3. Go back to Firebase step 4 and add this final domain to **Authorized domains**, or Google Sign-In will fail on your live site with a "domain not authorized" error.

## 9. Generate a deploy credential and add it as a GitHub Secret
Since Cloudflare's own Git-connected build now handles building and deploying the frontend itself, the GitHub Actions workflow in this repo only needs one secret pair, for the Firestore rules job:
- `FIREBASE_TOKEN` — generate by running `firebase login:ci` locally (interactive browser login, one time) and copying the printed token.
- `FIREBASE_PROJECT_ID` — your Firebase project ID from step 3.

Add both at your repo → **Settings → Secrets and variables → Actions → New repository secret**. These are secrets by definition, so they need to be typed into GitHub's UI by you rather than committed to the repo or handed to an agent.

*(If you ever want Claude Code to run `wrangler deploy` locally for a manual/test deploy outside of Cloudflare's automatic pipeline, that needs a one-time interactive `npx wrangler login` in your terminal — same pattern as the Firebase CLI in step 6.)*

---

### Summary — what Claude Code *can* do once the above exists
Once you've done steps 1–6 (accounts, repo, Firebase project + Auth + Firestore + CLI login) Claude Code can freely: write and run all app code, run `npm install`/`npm run build`/`npm run dev`, run `firebase deploy --only firestore` for rules/indexes, commit and push to GitHub, and iterate on the GitHub Actions workflow — all of that is normal terminal/file work it doesn't need a browser for, and none of it touches billing.

### If you ever outgrow Spark
If a future version genuinely needs server-side compute (higher-quality Potrace tracing, ML-based inpainting, etc.), that would mean deliberately revisiting the decision to avoid Blaze — at which point re-read the billing-risk discussion in the chat history/`docs/requirements.md` §3 before deciding how to bound the cost (e.g. R2 for storage instead of Firebase Storage, since it has no egress fees, and app-level rate limiting on any endpoint you add).
