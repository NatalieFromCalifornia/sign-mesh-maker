import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { Button } from '../components/ui/Button';
import { NumberField } from '../components/ui/NumberField';
import { Panel } from '../components/ui/Panel';
import { Dropzone, MAX_UPLOAD_BYTES } from '../components/Dropzone';
import { Viewer, type ViewerHandle } from '../components/Viewer';
import { ArtworkPreview } from '../components/ArtworkPreview';
import { cn } from '../lib/cn';
import {
  averageColor,
  groupLayersByColor,
  parseSvgLayers,
  SvgParseError,
  type ParsedSvg,
} from '../lib/svgLayers';
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
  /** Per-source-layer color overrides; same color on two layers merges them (§5.4). */
  const [assigned, setAssigned] = useState<string[]>([]);
  /** Indices into the merged group list, for the merge action. */
  const [selected, setSelected] = useState<Set<number>>(new Set());

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

  /*
   * Everything downstream — preview, heights, mesh — runs on the merged view,
   * so assigning two layers the same color genuinely produces one printed
   * layer rather than two at the same height.
   */
  const groups = useMemo(
    () => (parsed ? groupLayersByColor(parsed.layers, assigned) : []),
    [parsed, assigned],
  );

  const effective = useMemo(
    () => (parsed ? { ...parsed, layers: groups } : null),
    [parsed, groups],
  );

  const layers = useMemo(
    () => (effective ? layerAssignments(effective, config) : []),
    [effective, config],
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
    setAssigned([]);
    setSelected(new Set());
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
        setError('Only SVG is supported. Convert artwork to SVG and try again.');
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

        setAssigned([]);
        setSelected(new Set());
        setParsed(parseSvgLayers(await file.text()));
      } catch (cause) {
        setFileName(null);
        setError(
          cause instanceof SvgParseError ? cause.message : 'That file could not be read.',
        );
        console.error('Upload failed', cause);
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
    if (!effective) return;
    setBusy(true);
    setError(null);

    // Yield a frame so the button's busy state paints before the main thread
    // blocks on triangulation.
    requestAnimationFrame(() => {
      try {
        const built = buildMesh(effective, config);
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
  }, [effective, config]);

  /** Writes an assignment for every source layer folded into group `groupIndex`. */
  const assignToGroup = useCallback(
    (groupIndex: number, color: string) => {
      if (!parsed) return;
      setAssigned((current) => {
        const next = parsed.layers.map((layer, i) => current[i] ?? layer.color);
        for (const source of groups[groupIndex]?.sourceIndices ?? []) {
          next[source] = color.toLowerCase();
        }
        return next;
      });
      setStale(true);
    },
    [parsed, groups],
  );

  const recolor = useCallback(
    (groupIndex: number, color: string) => assignToGroup(groupIndex, color),
    [assignToGroup],
  );

  const toggleSelected = useCallback((groupIndex: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(groupIndex)) next.delete(groupIndex);
      else next.add(groupIndex);
      return next;
    });
  }, []);

  /*
   * Merging is expressed as "give these layers the same color", which is the
   * rule requirements §5.4 already defines — so there's one mechanism, not two,
   * and merged layers automatically share a height.
   */
  const mergeSelected = useCallback(() => {
    if (!parsed || selected.size < 2) return;
    const indices = [...selected];
    const target = averageColor(indices.map((i) => groups[i].color));

    setAssigned(() => {
      const next = parsed.layers.map((layer, i) => assigned[i] ?? layer.color);
      for (const groupIndex of indices) {
        for (const source of groups[groupIndex].sourceIndices) next[source] = target;
      }
      return next;
    });
    setSelected(new Set());
    setStale(true);
  }, [parsed, selected, groups, assigned]);

  const resetColors = useCallback(() => {
    setAssigned([]);
    setSelected(new Set());
    setStale(true);
  }, []);

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
                {effective && <ArtworkPreview parsed={effective} highlightIndex={hovered} />}
              </div>
            </Panel>

            <Panel
              title={`Layers · ${layers.length}`}
              description="Lowest first. Recolor a layer, or select two or more to merge."
              actions={
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={selected.size < 2}
                    onClick={mergeSelected}
                  >
                    Merge
                  </Button>
                  {assigned.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={resetColors}>
                      Reset
                    </Button>
                  )}
                </div>
              }
            >
              <ul className="flex flex-col">
                {layers.map((layer, i) => {
                  const merged = groups[i]?.sourceIndices.length ?? 1;
                  const isSelected = selected.has(i);

                  return (
                    <li
                      key={`${layer.color}-${i}`}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                      className={cn(
                        'flex items-center gap-3 border-b border-rule py-2.5 last:border-b-0',
                        'transition-colors',
                        hovered === i && 'bg-bench-2',
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select layer ${layer.color}`}
                        checked={isSelected}
                        onChange={() => toggleSelected(i)}
                        className="size-3.5 shrink-0 accent-signal"
                      />

                      {/*
                        A real colour input, not a swatch. The previous swatch
                        looked editable and wasn't, which is worse than plainly
                        read-only.
                      */}
                      <label className="relative size-5 shrink-0 cursor-pointer">
                        <span
                          className="block size-full rounded-[2px] border border-rule-strong"
                          style={{ backgroundColor: layer.color }}
                        />
                        <input
                          type="color"
                          aria-label={`Color for layer ${layer.color}`}
                          value={layer.color}
                          onChange={(e) => recolor(i, e.target.value)}
                          className="absolute inset-0 size-full cursor-pointer opacity-0"
                        />
                      </label>

                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-mono text-xs uppercase text-graphite">
                          {layer.color}
                        </span>
                        {merged > 1 && (
                          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-graphite/70">
                            {merged} merged
                          </span>
                        )}
                      </span>

                      <span className="shrink-0 font-mono text-xs tabular-nums text-chalk">
                        {layer.heightMm.toFixed(2)} mm
                      </span>
                    </li>
                  );
                })}
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
                {layers.length} color layers ready to extrude.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
