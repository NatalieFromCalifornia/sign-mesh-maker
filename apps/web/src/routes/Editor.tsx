import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Panel } from '../components/ui/Panel';
import { Dropzone, MAX_UPLOAD_BYTES } from '../components/Dropzone';
import { Viewer } from '../components/Viewer';
import { ArtworkPreview } from '../components/ArtworkPreview';
import { cn } from '../lib/cn';
import { parseSvgLayers, SvgParseError, type ParsedSvg } from '../lib/svgLayers';
import {
  buildMesh,
  disposeGroup,
  layerAssignments,
  type MeshConfig,
} from '../lib/buildMesh';
import { downloadStl, stlFilename } from '../lib/exportStl';

const DEFAULT_CONFIG: MeshConfig = {
  // Defaults suggested in requirements §5.3.
  widthMm: 120,
  baseMm: 2,
  layerMm: 1,
};

/** Parses a numeric input without letting an empty field become NaN. */
function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function Editor() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSvg | null>(null);
  const [config, setConfig] = useState<MeshConfig>(DEFAULT_CONFIG);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [stats, setStats] = useState<{ triangles: number; depth: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [view, setView] = useState<'artwork' | 'mesh'>('artwork');
  /** Layer row under the cursor, isolated in the flat preview. */
  const [hovered, setHovered] = useState<number | null>(null);

  // The built group is a three.js resource, not React state to be GC'd — it
  // has to be disposed explicitly when replaced or unmounted.
  const groupRef = useRef<THREE.Group | null>(null);
  useEffect(() => {
    groupRef.current = group;
  }, [group]);
  useEffect(() => {
    return () => {
      if (groupRef.current) disposeGroup(groupRef.current);
    };
  }, []);

  const heightMm = useMemo(() => {
    if (!parsed) return null;
    return (parsed.height / parsed.width) * config.widthMm;
  }, [parsed, config.widthMm]);

  const layers = useMemo(
    () => (parsed ? layerAssignments(parsed, config) : []),
    [parsed, config],
  );

  const reset = useCallback(() => {
    setGroup((current) => {
      if (current) disposeGroup(current);
      return null;
    });
    setParsed(null);
    setFileName(null);
    setStats(null);
    setError(null);
    setStale(false);
    // Without this the pane would stay on a mesh tab that no longer has a mesh.
    setView('artwork');
    setHovered(null);
  }, []);

  const onFile = useCallback(
    async (file: File) => {
      setError(null);

      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`);
        return;
      }

      const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
      if (!isSvg) {
        setError(
          'Only SVG works right now. Tracing a PNG or JPG to vector is the next step to be built.',
        );
        return;
      }

      setBusy(true);
      try {
        const next = parseSvgLayers(await file.text());
        setGroup((current) => {
          if (current) disposeGroup(current);
          return null;
        });
        setParsed(next);
        setFileName(file.name);
        setStats(null);
        setStale(false);
        setView('artwork');
        setHovered(null);
      } catch (cause) {
        setError(
          cause instanceof SvgParseError ? cause.message : 'That SVG could not be read.',
        );
        console.error('SVG parse failed', cause);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /*
   * Explicitly triggered, never reactive to config edits — requirements §5.6,
   * because building the mesh is the expensive step.
   */
  const generate = useCallback(() => {
    if (!parsed) return;
    setBusy(true);
    setError(null);

    // Yield a frame so the button's busy state paints before the main thread
    // blocks on triangulation.
    requestAnimationFrame(() => {
      try {
        const built = buildMesh(parsed, config);
        setGroup((current) => {
          if (current) disposeGroup(current);
          return built.group;
        });
        setStats({ triangles: built.triangles, depth: built.sizeMm.depth });
        setStale(false);
        setView('mesh');
      } catch (cause) {
        setError('The mesh could not be built from this artwork.');
        console.error('Mesh build failed', cause);
      } finally {
        setBusy(false);
      }
    });
  }, [parsed, config]);

  const update = useCallback((patch: Partial<MeshConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setStale(true);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-mono text-lg uppercase tracking-[0.08em] text-chalk">Editor</h1>
        {fileName && (
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-graphite">{fileName}</span>
            <Button size="sm" variant="ghost" onClick={reset}>
              Start over
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm leading-relaxed text-danger">
          {error}
        </p>
      )}

      {!parsed ? (
        <Dropzone onFile={(f) => void onFile(f)} disabled={busy} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-6">
            <Panel title="Dimensions">
              <div className="flex flex-col gap-5">
                <Field
                  label="Width"
                  type="number"
                  min={1}
                  step={1}
                  suffix="mm"
                  value={config.widthMm}
                  onChange={(e) => update({ widthMm: toNumber(e.target.value, config.widthMm) })}
                />
                <div className="flex flex-col gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
                    Height
                  </span>
                  <p className="font-mono text-sm tabular-nums text-graphite">
                    {heightMm ? `${heightMm.toFixed(1)} mm` : '—'}{' '}
                    <span className="text-graphite/70">(from aspect)</span>
                  </p>
                </div>
                <Field
                  label="Base thickness"
                  type="number"
                  min={0.1}
                  step={0.1}
                  suffix="mm"
                  value={config.baseMm}
                  onChange={(e) => update({ baseMm: toNumber(e.target.value, config.baseMm) })}
                />
                <Field
                  label="Layer step"
                  type="number"
                  min={0.1}
                  step={0.1}
                  suffix="mm"
                  hint="Added per layer above the base."
                  value={config.layerMm}
                  onChange={(e) => update({ layerMm: toNumber(e.target.value, config.layerMm) })}
                />
              </div>
            </Panel>

            <Panel
              title={`Layers · ${layers.length}`}
              description="One per fill color, lowest first (SVG document order)."
            >
              <ul className="flex flex-col">
                {layers.map((layer, i) => (
                  <li
                    key={`${layer.color}-${i}`}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      'flex items-center justify-between gap-3 border-b border-rule py-2.5 last:border-b-0',
                      'transition-colors',
                      hovered === i && 'bg-bench-2',
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="size-4 rounded-[2px] border border-rule-strong"
                        style={{ backgroundColor: layer.color }}
                      />
                      <span className="font-mono text-xs uppercase text-graphite">
                        {layer.color}
                      </span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-chalk">
                      {layer.heightMm.toFixed(2)} mm
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <div className="flex flex-col gap-3">
              <Button variant="primary" onClick={generate} disabled={busy}>
                {busy ? 'Working…' : group ? 'Regenerate mesh' : 'Generate mesh'}
              </Button>
              {stale && group && (
                <p className="text-sm leading-relaxed text-graphite">
                  Settings changed since this mesh was built. Regenerate to apply them.
                </p>
              )}
              <Button
                variant="secondary"
                disabled={!group}
                onClick={() => group && downloadStl(group, stlFilename(fileName ?? 'sign'))}
              >
                Download STL
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-[3px] border border-rule bg-bench p-1">
                {(['artwork', 'mesh'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={mode === 'mesh' && !group}
                    onClick={() => setView(mode)}
                    className={cn(
                      'rounded-[2px] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors',
                      'disabled:cursor-not-allowed disabled:opacity-40',
                      view === mode ? 'bg-bench-2 text-chalk' : 'text-graphite hover:text-chalk',
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {view === 'mesh' && group && (
                <p className="font-mono text-[11px] text-graphite">
                  Drag to rotate · scroll to zoom · right-drag to pan
                </p>
              )}
            </div>

            <div className="relative h-[420px] overflow-hidden rounded-panel border border-rule lg:h-[560px]">
              {/* The viewer stays mounted while the flat preview is showing, so
                  the camera keeps its position instead of resetting on toggle. */}
              <Viewer group={group} className={view === 'mesh' ? 'size-full' : 'hidden'} />

              {view === 'artwork' && (
                <div className="absolute inset-0 p-8">
                  <ArtworkPreview parsed={parsed} highlightIndex={hovered} />
                </div>
              )}
            </div>

            {view === 'mesh' && stats ? (
              <p className="font-mono text-[11px] tabular-nums text-graphite">
                {config.widthMm.toFixed(0)} × {heightMm?.toFixed(1)} × {stats.depth.toFixed(2)} mm
                {' · '}
                {stats.triangles.toLocaleString()} triangles
              </p>
            ) : (
              <p className="font-mono text-[11px] text-graphite">
                {parsed.layers.length} color layers, drawn from the parsed geometry — this is
                exactly what gets extruded.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
