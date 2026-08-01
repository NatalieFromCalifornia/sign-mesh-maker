import { Panel } from '../components/ui/Panel';

/*
 * Placeholder for the pipeline described in requirements §4. The shell, routing
 * and auth (phases 1–2) are real; every step listed below is still to come, so
 * this screen states that plainly rather than showing controls that do nothing.
 */
const PIPELINE = [
  { phase: 3, title: 'Upload', detail: 'PNG, JPG or SVG, up to 20 MB.' },
  { phase: 5, title: 'Cleanup', detail: 'Lasso unwanted regions; OpenCV.js inpainting.' },
  { phase: 4, title: 'Vectorize', detail: 'Palette detection, then tracing to SVG.' },
  { phase: 6, title: 'Configure', detail: 'Crop, dimensions, thickness, layer colors.' },
  { phase: 7, title: 'Generate mesh', detail: 'Stepped heights, then flat mode with gaps.' },
  { phase: 8, title: 'Export STL', detail: 'Binary STL, generated in the browser.' },
];

export function Editor() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Editor</h1>
        <p className="mt-1 text-sm text-muted">
          Turn a 2D image or SVG into a multi-color, 3D-printable sign.
        </p>
      </div>

      <Panel
        title="Pipeline not implemented yet"
        description="Phases 1–2 (app shell, routing, Google auth) are in place. The steps below land next, in the order given in docs/requirements.md §10."
      >
        <ol className="flex flex-col gap-3">
          {PIPELINE.map((step) => (
            <li key={step.title} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-xs text-muted">
                {step.phase}
              </span>
              <div>
                <p className="text-sm text-fg">{step.title}</p>
                <p className="text-sm text-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
