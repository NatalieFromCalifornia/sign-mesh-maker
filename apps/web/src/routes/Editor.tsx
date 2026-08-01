/*
 * Placeholder for the pipeline in requirements §4. The shell, routing and auth
 * (phases 1–2) are real; every step below is still to come, so this screen says
 * so plainly rather than showing controls that do nothing.
 *
 * Kept deliberately plain — phase 3 replaces this screen wholesale, so design
 * effort spent here would be thrown away.
 *
 * The numbering is the build order from requirements §10, not decoration: these
 * steps genuinely are a sequence, and the numbers are the reader's map to the
 * spec.
 */
const PIPELINE = [
  { phase: 3, title: 'Upload', detail: 'PNG, JPG or SVG, up to 20 MB.' },
  { phase: 5, title: 'Clean up', detail: 'Lasso what you don’t want; the gap is filled from the surrounding image.' },
  { phase: 4, title: 'Trace', detail: 'Pick a color count, then convert the image to vector shapes.' },
  { phase: 6, title: 'Configure', detail: 'Crop, set the sign size in mm, and give each color a height.' },
  { phase: 7, title: 'Generate', detail: 'Build the mesh — stepped heights, or flat with color gaps.' },
  { phase: 8, title: 'Export', detail: 'Download a binary STL, built in the browser.' },
];

export function Editor() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-mono text-lg uppercase tracking-[0.08em] text-chalk">Editor</h1>
      <p className="mt-3 text-sm leading-relaxed text-graphite">
        Nothing to edit yet. The steps below arrive in the order given in{' '}
        <span className="font-mono text-chalk">docs/requirements.md §10</span> — the app
        shell, routing and sign-in are done.
      </p>

      <ol className="mt-10 border-t border-rule">
        {PIPELINE.map((step) => (
          <li
            key={step.title}
            className="flex gap-5 border-b border-rule py-4 first:pt-5"
          >
            <span className="w-7 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-graphite">
              {String(step.phase).padStart(2, '0')}
            </span>
            <div>
              <p className="font-mono text-[13px] uppercase tracking-[0.08em] text-chalk">
                {step.title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-graphite">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
