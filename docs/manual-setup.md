# Manual Setup — Things Claude Code Can't Do For You

Claude Code operates on your local filesystem/terminal. It can write code, run
CLIs once you're authenticated, and even run some CLI commands *for* you — but
anything that requires an interactive browser login, clicking through a
console UI, or entering billing/payment details has to be done by you, by
hand, in a browser. This is the ordered list of those steps.

Do steps 1–6 **before** you point Claude Code at the repo, since the codebase
needs real project IDs/config values to run against. Steps 7+ happen after
Claude Code has built enough to deploy.

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
3. Under **Project settings → General**, add a **Web app** — this gives you the `firebaseConfig` object (`apiKey`, `authDomain`, `projectId`, `storageBucket`, etc.). You'll paste these into the web app's environment variables (e.g. `apps/web/.env.local`) — Claude Code can wire up the code to *read* them, but you have to supply the actual values since they come from a page only you can access.

## 4. Enable Google Sign-In
1. In the Firebase console: **Build → Authentication → Sign-in method**.
2. Enable the **Google** provider, set a support email.
3. Under **Authentication → Settings → Authorized domains**, this list needs to include:
   - `localhost` (already there by default, for local dev)
   - your Cloudflare Pages `*.pages.dev` domain, once step 9 exists
   - your final custom domain, once DNS is set up (step 11)
   - You'll come back to add the last two after they exist — Claude Code can remind you, but can't click this toggle for you.

## 5. Create the Firestore database
1. Firebase console → **Build → Firestore Database → Create database**.
2. Choose a region (pick one close to your users; it can't be changed later without migrating).
3. Start in **production mode** (the `firestore.rules` file in this repo will be deployed over it — see step 7).

## 6. Enable Cloud Storage — requires the Blaze (pay-as-you-go) plan
As of the changes Google announced in 2024–2025, **Cloud Storage for Firebase
now requires the Blaze pricing plan** — the free Spark plan can no longer
provision or (as of the 2026 rollout) even access Storage buckets. There's
still a generous no-cost usage tier on Blaze, but you must add a billing
account.
1. Firebase console → gear icon → **Usage and billing** → **Modify plan** → select **Blaze** → attach a billing account/credit card.
2. Then: **Build → Storage → Get started** to provision the default bucket.
3. This step involves entering payment details, so it has to be you.

## 7. Install and authenticate the Firebase CLI (one-time, interactive)
```
npm install -g firebase-tools
firebase login          # opens a browser, you log in interactively
firebase use --add      # link this repo to the Firebase project you created
```
After this one-time interactive login, Claude Code *can* run `firebase deploy --only firestore:rules,storage` etc. on your behalf, since the CLI will already be authenticated on your machine.

## 8. Create a Cloudflare Pages project
1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorize Cloudflare's GitHub App and pick the repo you created in step 2 (this GitHub↔Cloudflare OAuth authorization is an interactive click-through only you can do).
3. Set build settings: build command `npm run build --workspace=apps/web`, output directory `apps/web/dist`.
4. This creates your `*.pages.dev` URL immediately — deploys after this point can happen automatically on every push, or via the GitHub Action already scaffolded in `.github/workflows/deploy.yml`.

## 9. Point your custom domain at Cloudflare Pages
1. If the domain isn't already on Cloudflare: **Add a site** in the Cloudflare dashboard and update your registrar's nameservers to Cloudflare's (this nameserver change happens at your domain registrar, outside of Cloudflare/Claude Code entirely, and can take anywhere from minutes to ~24h to propagate).
2. In the Pages project → **Custom domains → Set up a custom domain**, enter your domain/subdomain. Cloudflare auto-creates the DNS record if the zone is already on Cloudflare.
3. Go back to Firebase step 4 and add this final domain to **Authorized domains**, or Google Sign-In will fail on your live site with a "domain not authorized" error.

## 10. Generate deploy credentials and add them as GitHub Secrets
The GitHub Actions workflow in this repo needs four secrets. Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**, and add:
- `CLOUDFLARE_API_TOKEN` — create at Cloudflare dashboard → **My Profile → API Tokens → Create Token** (use the "Edit Cloudflare Pages" template).
- `CLOUDFLARE_ACCOUNT_ID` — found on any domain's Overview page in the Cloudflare dashboard, right sidebar.
- `FIREBASE_TOKEN` — generate by running `firebase login:ci` locally (interactive browser login, one time) and copying the printed token.
- `FIREBASE_PROJECT_ID` — your Firebase project ID from step 3.

These are secrets by definition, so they need to be typed into GitHub's UI by you rather than committed to the repo or handed to an agent.

## 11. (Only if you outgrow client-side vectorization/inpainting) Enable Cloud Functions billing
Cloud Functions (2nd gen) also require the Blaze plan, which you'll already be on from step 6. No extra action needed unless Google changes function-specific quotas later — just something to keep an eye on if you add the optional server-side Potrace/OpenCV function described in the requirements doc.

---

### Summary — what Claude Code *can* do once the above exists
Once you've done steps 1–7 (accounts, repo, Firebase project + Auth + Firestore + Storage + CLI login) Claude Code can freely: write and run all app code, run `npm install`/`npm run build`/`npm run dev`, run `firebase deploy` for rules/functions, commit and push to GitHub, and iterate on the GitHub Actions workflow — all of that is normal terminal/file work it doesn't need a browser for.
