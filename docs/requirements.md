# Sign Mesh Maker — Design & Requirements Document

**Purpose of this document:** This is a build spec intended to be handed directly to an agentic coding assistant (Claude Code) to implement and deploy the application. It describes the product, user flows, architecture, data model, algorithms, and a phased implementation plan.

---

## 1. Product Overview

**Sign Mesh Maker** is a web application that turns a 2D image or vector graphic into a multi-color (or single-color relief) 3D-printable STL mesh, suitable for producing physical signs on multi-material or color-changing FDM printers.

Core pipeline:

```
Upload Image → Remove Unwanted Elements → Vectorize (if raster) →
Configure 3D Layering (dimensions, thickness, layer colors) →
Generate Mesh → Preview → Export STL
```

Users can log in with Google to save projects (SVG + settings + a preview thumbnail) for later editing.

---

## 2. Goals / Non-Goals

**Goals**
- Let a non-technical user go from a logo/graphic image to a printable multi-layer STL in a few guided steps.
- Support both raster (PNG/JPG) and vector (SVG) input.
- Give the user direct control over palette size, layer heights, colors, cropping, and physical dimensions.
- Persist projects per user account.

**Non-Goals (v1)**
- Not a general-purpose vector editor (no freeform path drawing/bezier editing beyond what's needed for cleanup).
- Not a slicer — output is STL only, not G-code.
- No real-time collaborative editing.
- No mobile app — responsive web only.

---

## 3. Recommended Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | React + TypeScript (Vite) | Fast dev server, good ecosystem for canvas/3D libs |
| 3D preview & mesh building | three.js | Scene rendering, `STLExporter`, `BufferGeometry` construction |
| 2D canvas editing (circle-to-remove, crop) | HTML5 Canvas / Konva.js | Konva simplifies shape drawing, selection, transforms |
| Vectorization (raster → SVG) | `imagetracerjs` (client-side, no server needed) or `potrace` (Node, server-side via Cloud Function) | See §9.2 for tradeoffs |
| Color quantization / palette detection | Custom k-means (or `quantize`/`node-vibrant`-style lib) on raw pixel data | See §9.1 |
| Inpainting (object removal) | Cloud Function using OpenCV.js or a hosted inpainting API | See §9.3 — this is the least trivial piece, treat as its own milestone |
| Polygon triangulation for extrusion | `earcut` | Standard for turning SVG paths into flat meshes for extrusion |
| Path/CSG boolean ops (layer merging, gaps in flat mode) | `three-bvh-csg` or `manifold-3d` (WASM) | Needed to cut gaps between same-height flat layers cleanly |
| Auth | Firebase Authentication (Google provider) | Matches stated requirement |
| Database | Firebase Firestore | Project metadata, layer configs |
| File storage | Firebase Storage | Original images, SVGs, thumbnails, generated STLs (or generate STL client-side and not store it) |
| Hosting / CDN | Cloudflare Pages (static frontend) + Cloudflare Workers or Firebase Cloud Functions for backend tasks | Matches "my Cloudflare URL" requirement |
| Repo / CI | GitHub + GitHub Actions | Build/test/deploy pipeline |

**Key architecture decision to flag for the implementer:** Cloudflare Pages serves the static frontend, but Firebase Cloud Functions (Node) are the natural place for anything needing OpenCV/potrace/heavy image processing, since Cloudflare Workers don't support native binaries/WASM-heavy CV libraries as easily. Recommend: **frontend on Cloudflare Pages, backend processing on Firebase Cloud Functions (2nd gen), DB/Auth/Storage on Firebase.** Cloudflare Worker can act as a thin proxy/custom-domain router in front of Firebase if a unified domain is desired.

---

## 4. User Flow (Step by Step)

1. **Sign in (optional at this stage, required to save)** — Google sign-in via Firebase Auth. Anonymous use allowed for a session; prompted to log in when saving.
2. **Upload image** — accepts PNG, JPG, or SVG.
3. **Cleanup step** — user circles/lassos unwanted regions on the image; those regions are removed and inpainted with surrounding background. User can repeat/undo. User clicks "Looks good" to proceed.
   - If the uploaded file was SVG, this step is skipped entirely (SVGs are assumed already clean vector art — optionally allow deleting whole `<path>`/`<g>` elements by click-selection instead of freehand circling, see §6.1 note).
4. **Vectorization step (raster inputs only)**
   - App analyzes the image's color palette.
   - Shows detected palette swatches + editable "number of colors" field + live-updating vector preview as the user tunes that number.
   - User confirms → produces final clean SVG.
5. **3D configuration step**
   - Crop tool over the (rasterized preview of the) SVG.
   - Set final sign dimension in mm (single edge, e.g. width; height auto-scales to preserve aspect ratio).
   - Set base/background layer thickness (mm).
   - Set per-subsequent-layer thickness (mm) — applies uniformly as the "step height" between color layers, unless flat mode is on.
   - Layer list: one entry per detected color, each showing a color swatch (editable/re-assignable) and computed height. Assigning two layers the same color merges them into one mesh layer.
   - "Flat mesh" toggle: when on, all non-base layers sit at the same top height; colors are separated by a configurable gap (default 0.08 mm) instead of by height steps.
   - "Generate Mesh" button — explicitly triggered, not live-reactive to config changes.
6. **Preview & export**
   - three.js viewer shows the generated mesh (rotate/zoom/pan), colored per-layer for clarity.
   - "Download STL" button (single combined STL, or optionally one STL per color layer — see §6.8).
7. **Save project** (if logged in) — stores SVG, config JSON, and a thumbnail under an editable project name. Accessible later from a "My Projects" dashboard to reload and continue editing.

---

## 5. Feature Specifications

### 6.1 Upload & Object Removal (Inpainting)
- Accept PNG/JPG/SVG via drag-drop or file picker. Max file size: 20 MB (configurable).
- If SVG: parse and rasterize to a preview canvas for display purposes only; original SVG DOM is retained as source of truth. Skip inpainting UI. Optionally (nice-to-have, not v1-blocking) allow the user to click individual `<path>`/`<g>` elements to delete them outright, since "circle an area to remove" doesn't map cleanly to vector data.
- If PNG/JPG:
  - User draws one or more closed freehand loops (lasso) or drags an ellipse/rectangle over unwanted regions (freehand loop is the primary described requirement; rectangle/ellipse as a fallback/simpler control).
  - On "Remove," selected region(s) are sent (or processed client-side, see §9.3) for inpainting — filled in using surrounding background texture/color, not just blurred or solid-filled.
  - Show before/after; allow additional passes; allow "Undo last removal" and "Reset to original."
  - "Continue" advances to vectorization (or directly to 3D config if source was SVG).

### 6.2 Raster → Vector Conversion
- **Palette detection:** run k-means (or median-cut) color quantization on the cleaned raster image to find the dominant colors. Default cluster count: 8 (user-editable, typical vector art has ≤10 colors per the product brief).
- **UI:** display swatches for the current palette count next to a live vector preview rendered with that many colors. Editable numeric field for color count re-runs quantization + retrace on change (this step *can* be near-live/on-blur, distinct from the final mesh generation which is explicitly button-triggered — call this out clearly in code comments since it's an intentional UX difference from §6.7).
- **Vectorization:** for each quantized color, build a binary mask and trace it to path(s) (e.g., via `imagetracerjs`'s posterization+tracing pipeline, or per-color Potrace bitmap tracing on the server). Merge into one SVG with one `<path>`/`<g>` per color, each tagged with a `data-color` / `fill` attribute so later steps can key off color for layering.
- Output: clean SVG with discrete, non-overlapping (or well-ordered z-stacked) colored regions.

### 6.3 3D Config — Crop & Dimensions
- Crop tool overlaid on a rendered preview of the SVG; supports drag-resize of a crop rectangle, optionally free aspect or locked to source aspect.
- Dimension input: one numeric field (e.g., "Width (mm)"), with the other dimension computed and displayed read-only from the aspect ratio.
- Base/background layer thickness field (mm), default suggestion e.g. 2 mm.
- Subsequent-layer thickness field (mm) — the step height added per layer above the base, default suggestion e.g. 1 mm.

### 6.4 Layer / Color Management
- Auto-generate one layer per distinct SVG color, ordered by... (implementer default: by area coverage, largest = base-adjacent — expose as a config the user could override in a later version; v1 can just use SVG document order or a fixed z-order rule, documented in code).
- Each layer row: color swatch (click to open color picker to reassign), computed height (`base_thickness + n * layer_thickness` where `n` is that layer's stack position), and a name/label.
- **Merge rule:** if the user sets two layers to the identical color (hex match), those layers' geometries are unioned into a single mesh layer at that shared height. Reflect this merge in the layer list UI (rows collapse).

### 6.5 Flat Mesh Mode
- Toggle in the config panel: "Flat mesh (same-height layers with color gaps)".
- When enabled:
  - All non-base layers extrude to the *same* top height (base thickness + one layer thickness — i.e., a single uniform top surface).
  - Adjacent-color regions are separated by an offset/gap (default 0.08 mm, user-editable) instead of relying on height steps for color separation. Implement via polygon offsetting (shrink each color region's path inward by gap/2 before extrusion) so a physical channel exists between colors, preventing color bleed on a multi-material printer.
  - Base layer thickness field still applies and behaves the same as in stepped mode.

### 6.6 Mesh Generation
- Triggered only by an explicit "Generate Mesh" button — no auto-regeneration on field change, since mesh building (especially CSG operations) can be expensive.
- Pipeline: SVG paths → 2D polygons (flatten curves to line segments at a reasonable tolerance) → per-layer triangulation (`earcut`) → extrude to that layer's height (Z) → position on top of/merged with base slab → (flat mode only) boolean-subtract gap channels → combine layers into one `THREE.Group`/scene, one mesh per color for both preview coloring and optional per-color STL export.
- Show a loading/progress indicator during generation — this can take a few seconds for detailed art.
- On completion, render in the three.js viewer with orbit controls, one material/color per layer matching the assigned colors.

### 6.7 Export
- "Download STL" — export the combined scene as a single binary STL (`THREE.STLExporter`), file name derived from project name.
- Nice-to-have (flag as stretch goal, not required for v1 sign-off): export one STL per color layer (zipped) for users doing manual multi-material swaps.

### 6.8 Auth & Projects
- Firebase Auth, Google provider only (per requirement). Sign-in button in header; show avatar/name + "Sign out" when authenticated.
- "Save Project" (only enabled when authenticated): prompts for a project name (editable, defaults to something derived from the file name), stores:
  - the working SVG,
  - the full config JSON (crop rect, dimensions, base/layer thickness, per-layer color/height overrides, flat-mode toggle + gap value),
  - a rendered thumbnail/preview image.
- "My Projects" page: grid/list of saved projects (thumbnail + name + last-modified), click to reload into the editor at the 3D-config step (SVG + config restored), rename, delete.

---

## 6. Data Model

### Firestore

```
users/{uid}
  displayName: string
  email: string
  photoURL: string
  createdAt: timestamp

projects/{projectId}
  ownerUid: string          // == users/{uid}, indexed for querying "my projects"
  name: string
  createdAt: timestamp
  updatedAt: timestamp
  svgStoragePath: string     // pointer into Firebase Storage
  thumbnailStoragePath: string
  config: {
    cropRect: { x, y, width, height }
    dimensionMm: { width, height }     // height derived but cached
    baseThicknessMm: number
    layerThicknessMm: number
    flatMode: boolean
    flatGapMm: number
    layers: [
      { id, originalColor, assignedColor, order, mergedWith?: [layerIds] }
    ]
  }
```

### Firebase Storage layout
```
/users/{uid}/projects/{projectId}/source.(png|jpg|svg)   // original upload
/users/{uid}/projects/{projectId}/cleaned.svg              // post-vectorization
/users/{uid}/projects/{projectId}/thumbnail.png
```
STL files are generated client-side on demand and downloaded directly (not stored), to avoid storage bloat — store only the SVG + config, since STL is fully re-derivable from them. Flag this as the default; storing STLs too is a simple addition if the user wants it later.

### Firestore Security Rules (summary)
- `projects/{projectId}`: read/write only where `request.auth.uid == resource.data.ownerUid` (and on create, `request.auth.uid == request.resource.data.ownerUid`).
- `users/{uid}`: read/write only by that uid.
- Storage rules mirror this: paths under `/users/{uid}/...` only accessible to that uid.

---

## 7. Algorithms & Libraries — Detail Notes

### 9.1 Palette Detection / Quantization
- k-means over pixel RGB(A) values, `k` = user-editable color count (default 8). Ignore fully-transparent pixels. Consider converting to a perceptual space (Lab) for better cluster quality if time allows; RGB k-means is an acceptable v1 baseline.
- Re-running on color-count change should be debounced (e.g., 300 ms after the user stops typing) since it's not the "explicit generate" step described in §6.7 — this quantization preview is a separate, faster loop.

### 9.2 Vectorization
- Client-side option: `imagetracerjs` — pure JS, runs in-browser, no server round-trip, good enough quality for logos/signage art. Recommended default for v1 to keep infra simple.
- Server-side alternative: Potrace (via a Cloud Function) traces one color mask at a time — higher quality curves, but requires a server hop per attempt. Consider this if `imagetracerjs` output quality proves insufficient during implementation; keep the interface abstracted so the tracer backend is swappable.

### 9.3 Inpainting (Object Removal) — flagged as highest-risk milestone
Three viable approaches, roughly in increasing quality/complexity order:
1. **Simple client-side heuristic fill:** for the masked region, sample and blend nearby background pixels (e.g., a fast marching / Telea-style algorithm reimplemented in JS, or run OpenCV.js compiled to WASM in-browser). Keeps everything client-side, no backend needed.
2. **Server-side OpenCV (Cloud Function):** Node function using `opencv4nodejs` or calling out to a Python microservice running `cv2.inpaint` (Telea or Navier-Stokes algorithm). Good quality for simple backgrounds (flat colors, gradients), which is the common case for sign/logo art.
3. **ML-based inpainting API** (higher quality on complex photographic backgrounds, but adds a paid third-party dependency) — only pursue if v1 quality from (1)/(2) proves insufficient for real user images.
- **Recommendation:** implement OpenCV.js in-browser (option 1) first — it avoids backend complexity/cost entirely and sign/logo source images typically have simple, flat, or gradient backgrounds where Telea inpainting performs well.

### 9.4 Mesh / CSG
- `earcut` for polygon triangulation of each traced color region (after flattening SVG bezier curves to polylines at an adaptive tolerance).
- Extrusion via `THREE.ExtrudeGeometry` per layer shape, or manual buffer geometry construction if more control over side-wall welding between layers is needed.
- Boolean subtraction (for flat-mode gaps, and for cleanly seating higher layers into lower ones if regions overlap) via `three-bvh-csg` (fast, three.js-native) or `manifold-3d` (WASM, very robust, slightly heavier integration). Recommend starting with `three-bvh-csg` for simplicity; fall back to `manifold-3d` if boolean robustness issues appear on complex art.

---

## 8. Non-Functional Requirements

- **Performance:** vectorization preview updates should feel responsive (<1s for typical logo-sized images at moderate color counts). Full mesh generation may take several seconds for detailed art — must show progress/loading state and must not block the UI thread (use a Web Worker for triangulation/CSG if it causes jank).
- **Browser support:** latest Chrome/Edge/Firefox/Safari (desktop). No IE11 support needed.
- **File size limits:** cap uploads at 20 MB; cap output SVG complexity (e.g., warn if traced path count is extremely high, suggest lowering color count).
- **Accessibility:** standard keyboard navigation and color-contrast on UI chrome (not the generated art itself).
- **Error handling:** every async step (upload, inpaint, vectorize, generate mesh, save) needs visible loading and error states — don't fail silently.

---

## 9. Deployment & DevOps

- **Repo:** GitHub, monorepo suggested layout:
  ```
  /apps/web        # React frontend (deployed to Cloudflare Pages)
  /functions        # Firebase Cloud Functions (inpainting, optional server-side tracing)
  /packages/shared  # shared types (project config schema, etc.)
  ```
- **CI/CD:** GitHub Actions — on push to `main`: run lint/type-check/tests, build frontend, deploy to Cloudflare Pages; deploy `/functions` to Firebase on changes to that directory.
- **Environments:** at minimum a `production` Firebase project; a `staging`/`dev` Firebase project is recommended so schema/rules changes can be tested before going live.
- **Secrets:** Firebase config (API key etc.) is not secret by nature but should still live in environment variables per environment; any server-side keys (if a third-party inpainting API is later used) go in Cloud Functions config/secret manager, never in the frontend bundle.
- **Custom domain:** point the user's Cloudflare-managed domain at the Cloudflare Pages deployment for the frontend. If Cloud Functions need to sit behind the same domain, use a Cloudflare Worker route (e.g., `/api/*`) proxying to the Firebase Functions URL.

---

## 10. Suggested Implementation Phases (for the agentic coder)

1. **Scaffold:** repo structure, Firebase project (Auth + Firestore + Storage), Cloudflare Pages hookup, basic React app shell with routing (Editor, My Projects, Login).
2. **Auth:** Google sign-in, `users` collection bootstrap on first login.
3. **Upload + SVG passthrough path:** get an SVG all the way to the 3D viewer with a trivial single-layer extrusion, to validate the mesh pipeline end-to-end early.
4. **Raster pipeline:** palette detection UI + vectorization (client-side tracer) producing a usable SVG.
5. **Object removal step:** in-browser inpainting on masked regions.
6. **Full 3D config UI:** crop, dimensions, base/layer thickness, per-layer color assignment + merge behavior.
7. **Mesh generation:** stepped-height mode first, then flat mode with gap-based separation (CSG).
8. **STL export.**
9. **Project save/load:** Firestore + Storage wiring, My Projects dashboard.
10. **Polish:** loading states, error handling, responsive layout, empty states.

---

## 11. Open Questions / Assumptions to Confirm During Build

- Layer z-order when colors visually overlap in the source art (which color "wins" at a boundary) — v1 assumption: SVG document order, topmost element = highest layer.
- Whether per-color STL export (zipped) is needed for v1 or is a later addition — currently scoped as stretch goal.
- Maximum practical color count before mesh complexity/print time becomes impractical — worth a soft UI warning (e.g., above 10–12 colors) rather than a hard limit, consistent with the "most vector graphics have ≤10 colors" framing in the product brief.
- Whether anonymous (not-logged-in) users should be able to fully use the editor and only get gated at the "Save" step (assumed yes, per the flow in §4) versus requiring login upfront.
