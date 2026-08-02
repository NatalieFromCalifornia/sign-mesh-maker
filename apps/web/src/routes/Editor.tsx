import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { Button } from '../components/ui/Button';
import { NumberField } from '../components/ui/NumberField';
import { Panel } from '../components/ui/Panel';
import { Dropzone, MAX_UPLOAD_BYTES } from '../components/Dropzone';
import { Viewer, type ViewerHandle } from '../components/Viewer';
import { ArtworkPreview } from '../components/ArtworkPreview';
import { cn } from '../lib/cn';
import { parseSvgLayers, SvgParseError, type ParsedSvg } from '../lib/svgLayers';
import {
  DEFAULT_COLOR_COUNT,
  MAX_COLOR_COUNT,
  MIN_COLOR_COUNT,
  RasterError,
  fileToImageData,
  isRasterFile,
  traceImageData,
} from '../lib/raster';
import {
  buildMesh,
  disposeGroup,
  layerAssignments,
  type MeshConfig,
} from '../lib/buildMesh';
import { downloadStl, stlFilename } from '../lib/exportStl';

const DEFAULT_CONFIG: MeshConfig = {
  widthMm: 120,
  baseMm: 2,
  /*
   * 0.4 mm rather than the 1 mm floated in requirements §5.3. A step of 1 mm
   * makes a ten-color sign 11 mm thick, where small regions read as pillars
   * instead of color; 0.4 mm is also a common FDM layer height, so steps land
   * on whole printed layers.
   */
  layerMm: 0.4,
};

export function Editor() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSvg | null>(null);
  const [config, setConfig] = useState<MeshConfig>(DEFAULT_CONFIG);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [stats, setStats] = useState<{ triangles: number; depth: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  /** Layer row under the cursor, isolated in the flat preview. */
  const [hovered, setHovered] = useState<number | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);
  /** Source pixels for raster uploads, retraced whenever the color count changes. */
  const [raster, setRaster] = useState<ImageData | null>(null);
  const [colorCount, setColorCount] = useState(DEFAULT_COLOR_COUNT);
  const [palette, setPalette] = useState<string[]>([]);
  const [tracing, setTracing] = useState(false);

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
    setHovered(null);
    setRaster(null);
    setPalette([]);
    setColorCount(DEFAULT_COLOR_COUNT);
  }, []);

  const onFile = useCallback(
    async (file: File) => {
      setError(null);

      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`);
        return;
      }

      const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
      if (!isSvg && !isRasterFile(file)) {
        setError('Unsupported file. Upload an SVG, PNG, JPG or WebP.');
        return;
      }

      setBusy(true);
      try {
        setGroup((current) => {
          if (current) disposeGroup(current);
          return null;
        });
        setStats(null);
        setStale(false);
        setHovered(null);
        setFileName(file.name);

        if (isSvg) {
          setRaster(null);
          setParsed(parseSvgLayers(await file.text()));
        } else {
          // Vector art comes from the tracing effect below, which reruns as the
          // color count changes.
          setParsed(null);
          setRaster(await fileToImageData(file));
        }
      } catch (cause) {
        setFileName(null);
        setError(
          cause instanceof SvgParseError || cause instanceof RasterError
            ? cause.message
            : 'That file could not be read.',
        );
        console.error('Upload failed', cause);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /*
   * Retracing is the fast, near-live loop of requirements §9.1 — deliberately
   * unlike mesh generation, which stays behind an explicit button (§5.6).
   * Debounced so dragging the color count doesn't queue a trace per keystroke.
   */
  useEffect(() => {
    if (!raster) return;
    let cancelled = false;
    setTracing(true);

    const timer = window.setTimeout(() => {
      // Yield first so the tracing indicator paints before the main thread blocks.
      requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          const { svg, palette } = traceImageData(raster, colorCount);
          if (cancelled) return;
          setPalette(palette);
          setParsed(parseSvgLayers(svg));
          setError(null);
        } catch (cause) {
          if (cancelled) return;
          setError(
            cause instanceof RasterError || cause instanceof SvgParseError
              ? cause.message
              : 'This image could not be traced.',
          );
          console.error('Trace failed', cause);
        } finally {
          if (!cancelled) setTracing(false);
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [raster, colorCount]);

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

      {!parsed && !raster ? (
        <Dropzone onFile={(f) => void onFile(f)} disabled={busy} />
      ) : !parsed ? (
        <p className="py-16 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          Tracing image…
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-6">
            {raster && (
              <Panel
                title={tracing ? 'Tracing…' : `Tracing · ${palette.length} colors`}
                description="Updates as you change the count — unlike the mesh, which waits for the button."
              >
                <div className="flex flex-col gap-4">
                  <NumberField
                    label="Colors"
                    min={MIN_COLOR_COUNT}
                    max={MAX_COLOR_COUNT}
                    step={1}
                    value={colorCount}
                    onChange={setColorCount}
                  />
                  {palette.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {palette.map((color, i) => (
                        <span
                          key={`${color}-${i}`}
                          title={color}
                          className="size-5 rounded-[2px] border border-rule-strong"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                  {!tracing && palette.length > 0 && palette.length < colorCount && (
                    <p className="text-sm leading-relaxed text-graphite">
                      {colorCount} requested, {palette.length} distinct after quantizing — this
                      artwork doesn’t hold more.
                    </p>
                  )}
                  {colorCount > 12 && (
                    <p className="text-sm leading-relaxed text-graphite">
                      Above about 12 colors the mesh gets heavy and the print gets slow.
                    </p>
                  )}
                </div>
              </Panel>
            )}

            <Panel title="Dimensions">
              <div className="flex flex-col gap-5">
                <NumberField
                  label="Width"
                  unit="mm"
                  min={1}
                  max={1000}
                  step={5}
                  value={config.widthMm}
                  onChange={(widthMm) => update({ widthMm })}
                />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
                    Height
                  </span>
                  <p className="font-mono text-sm tabular-nums text-graphite">
                    {heightMm ? `${heightMm.toFixed(1)}` : '—'}
                    <span className="ml-1 text-graphite/70">mm</span>
                  </p>
                </div>
                <NumberField
                  label="Base thickness"
                  unit="mm"
                  min={0.2}
                  max={50}
                  step={0.2}
                  value={config.baseMm}
                  onChange={(baseMm) => update({ baseMm })}
                />
                <NumberField
                  label="Layer step"
                  unit="mm"
                  min={0.1}
                  max={20}
                  step={0.1}
                  hint="Added per layer above the base."
                  value={config.layerMm}
                  onChange={(layerMm) => update({ layerMm })}
                />
              </div>
            </Panel>

            {/* Sits directly above the layer list so hovering a row highlights
                the region right next to it, rather than across the screen. */}
            <Panel title="Artwork">
              <div className="flex h-40 items-center justify-center">
                <ArtworkPreview parsed={parsed} highlightIndex={hovered} />
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

          {/* Sticky so the mesh stays on screen while scrolling a long layer
              list — with ten layers the sidebar is far taller than the viewer. */}
          <div className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
                Mesh
              </span>
              {group && (
                <p className="hidden font-mono text-[11px] text-graphite sm:block">
                  Drag to rotate · scroll to zoom · right-drag to pan
                </p>
              )}
            </div>

            <div className="relative h-[420px] overflow-hidden rounded-panel border border-rule lg:h-[620px]">
              <Viewer ref={viewerRef} group={group} className="size-full" />

              {group ? (
                <button
                  type="button"
                  onClick={() => viewerRef.current?.resetView()}
                  className={cn(
                    'absolute right-3 top-3 rounded-[3px] border border-rule-strong bg-mat/85 px-3 py-1.5 backdrop-blur',
                    'font-mono text-[11px] uppercase tracking-[0.12em] text-graphite transition-colors',
                    'hover:border-signal hover:text-chalk',
                  )}
                >
                  Center view
                </button>
              ) : (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
                    Generate a mesh to preview it
                  </p>
                </div>
              )}
            </div>

            {stats ? (
              <p className="font-mono text-[11px] tabular-nums text-graphite">
                {config.widthMm.toFixed(0)} × {heightMm?.toFixed(1)} × {stats.depth.toFixed(2)} mm
                {' · '}
                {stats.triangles.toLocaleString()} triangles
              </p>
            ) : (
              <p className="font-mono text-[11px] text-graphite">
                {parsed.layers.length} color layers ready to extrude.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
