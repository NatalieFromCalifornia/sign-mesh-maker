/*
 * Placeholder for the pipeline in requirements §4. The shell, routing and auth
 * (phases 1–2) are real; every step below is still to come, so this screen says
 * so plainly rather than showing controls that do nothing.
 *
 * Kept deliberately plain — phase 3 replaces this screen wholesale, so design
 * effort spent here would be thrown away.
 *
 * These are the user's steps in the order they'll be walked (requirements §4),
 * numbered as that sequence. They are deliberately NOT numbered by §10 build
 * phase: the build order differs from the flow order — tracing is built before
 * cleanup — so phase numbers rendered against flow order read as 03, 05, 04
 * and look like a bug.
 */
const PIPELINE = [
  { title: 'Upload', detail: 'PNG, JPG or SVG, up to 20 MB.' },
  { title: 'Clean up', detail: 'Lasso what you don’t want; the gap is filled from the surrounding image.' },
  { title: 'Trace', detail: 'Pick a color count, then convert the image to vector shapes.' },
  { title: 'Configure', detail: 'Crop, set the sign size in mm, and give each color a height.' },
  { title: 'Generate', detail: 'Build the mesh — stepped heights, or flat with color gaps.' },
  { title: 'Export', detail: 'Download a binary STL, built in the browser.' },
];

export function Editor() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-mono text-lg uppercase tracking-[0.08em] text-chalk">Editor</h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-graphite">
        Nothing to edit yet. Sign-in, routing and the app shell are done; the six
        steps below are what the editor will walk you through.
      </p>

      <ol className="mt-10 border-t border-rule">
        {PIPELINE.map((step, i) => (
          <li
            key={step.title}
            className="flex gap-5 border-b border-rule py-4 first:pt-5"
          >
            <span className="w-7 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-graphite">
              {String(i + 1).padStart(2, '0')}
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
