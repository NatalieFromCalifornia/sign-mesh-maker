import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type * as THREE from 'three';
import { Button } from '../components/ui/Button';
import { NumberField } from '../components/ui/NumberField';
import { Panel } from '../components/ui/Panel';
import { Dropzone, MAX_UPLOAD_BYTES } from '../components/Dropzone';
import { Viewer, type ViewerHandle } from '../components/Viewer';
import { ArtworkPreview } from '../components/ArtworkPreview';
import { CropOverlay } from '../components/CropOverlay';
import { cn } from '../lib/cn';
import {
  averageColor,
  groupLayersByColor,
  parseSvgLayers,
  SvgParseError,
  type ParsedSvg,
} from '../lib/svgLayers';
import type { CropRect } from '@sign-mesh-maker/shared';
import {
  DEFAULT_FLAT_GAP_MM,
  FULL_CROP,
  buildMesh,
  isFullCrop,
  disposeGroup,
  layerAssignments,
  type MeshConfig,
} from '../lib/buildMesh';
import { downloadStl, stlFilename } from '../lib/exportStl';
import { DEFAULT_SLOTS, download3mf, threeMfFilename } from '../lib/export3mf';
import { renderThumbnail } from '../lib/thumbnail';
import {
  ProjectTooLargeError,
  describeFirestoreError,
  loadProject,
  saveProject,
} from '../lib/projects';
import { useAuth } from '../auth/AuthProvider';

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
  flatMode: false,
  flatGapMm: DEFAULT_FLAT_GAP_MM,
  crop: FULL_CROP,
};

export function Editor() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [fileName, setFileName] = useState<string | null>(null);
  /** Raw markup, kept so a save stores the source rather than a re-serialization. */
  const [svgText, setSvgText] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** Set after opening a project, so its mesh builds without a button press. */
  const [autoBuild, setAutoBuild] = useState(false);
  const [parsed, setParsed] = useState<ParsedSvg | null>(null);
  const [config, setConfig] = useState<MeshConfig>(DEFAULT_CONFIG);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  /**
   * Dimensions of the mesh that was actually built, captured at generation
   * time. Reporting live config here would describe a mesh that does not exist
   * yet — the numbers would change the instant a field was edited, while the
   * object on screen stayed as it was.
   */
  const [stats, setStats] = useState<
    { triangles: number; width: number; height: number; depth: number } | null
  >(null);
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
  /** Source-layer indices the user removed; excluded from every stage downstream. */
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [cropping, setCropping] = useState(false);
  /** Assigned colour per source layer, for previewing the uncropped artwork. */
  const assignedColors = useMemo(
    () => (parsed ? parsed.layers.map((layer, i) => assigned[i] ?? layer.color) : []),
    [parsed, assigned],
  );
  const [lockAspect, setLockAspect] = useState(false);
  /** Filament slots on the target printer; layers beyond this share a slot. */
  const [slots, setSlots] = useState(DEFAULT_SLOTS);

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

  /*
   * Aspect comes from the cropped region, not the whole artwork — the width
   * field describes the sign being printed, so the derived height has to as
   * well.
   */
  const heightMm = useMemo(() => {
    if (!parsed) return null;
    const crop = config.crop ?? FULL_CROP;
    const width = parsed.width * crop.width;
    const height = parsed.height * crop.height;
    return width > 0 ? (height / width) * config.widthMm : null;
  }, [parsed, config.widthMm, config.crop]);

  /*
   * Everything downstream — preview, heights, mesh — runs on the merged view,
   * so assigning two layers the same color genuinely produces one printed
   * layer rather than two at the same height.
   */
  const groups = useMemo(() => {
    if (!parsed) return [];
    // Deleted layers are dropped before grouping, so a merge of survivors
    // still produces one contiguous set of rows.
    const kept = parsed.layers.filter((_, i) => !deleted.has(i));
    const keptAssigned = parsed.layers
      .map((layer, i) => assigned[i] ?? layer.color)
      .filter((_, i) => !deleted.has(i));
    return groupLayersByColor(kept, keptAssigned);
  }, [parsed, assigned, deleted]);

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
    setDeleted(new Set());
    setSvgText(null);
    setConfig((current) => ({ ...current, crop: FULL_CROP }));
    setCropping(false);
    setProjectId(null);
    setProjectName('');
    setSavedAt(null);
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
        setDeleted(new Set());

        const text = await file.text();
        setParsed(parseSvgLayers(text));
        setSvgText(text);
        setProjectId(null);
        setSavedAt(null);
        setCropping(false);
        setConfig((current) => ({ ...current, crop: FULL_CROP }));
        setProjectName(file.name.replace(/\.svg$/i, ''));
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
        setStats({ triangles: built.triangles, ...built.sizeMm });
        setStale(false);
      } catch (cause) {
        setError('The mesh could not be built from this artwork.');
        console.error('Mesh build failed', cause);
      } finally {
        setBusy(false);
      }
    });
  }, [effective, config]);

  /**
   * Source-layer indices behind a merged group.
   *
   * Grouping runs over the surviving layers, so a group's sourceIndices are
   * positions in that filtered list — writing an assignment at those positions
   * directly would recolour the wrong layers once anything is deleted.
   */
  const sourceIndicesOf = useCallback(
    (groupIndex: number): number[] => {
      if (!parsed) return [];
      const keptToSource = parsed.layers
        .map((_, i) => i)
        .filter((i) => !deleted.has(i));
      return (groups[groupIndex]?.sourceIndices ?? []).map((i) => keptToSource[i]);
    },
    [parsed, groups, deleted],
  );

  /** Writes an assignment for every source layer folded into group `groupIndex`. */
  const assignToGroup = useCallback(
    (groupIndex: number, color: string) => {
      if (!parsed) return;
      setAssigned((current) => {
        const next = parsed.layers.map((layer, i) => current[i] ?? layer.color);
        for (const source of sourceIndicesOf(groupIndex)) next[source] = color.toLowerCase();
        return next;
      });
      setStale(true);
    },
    [parsed, sourceIndicesOf],
  );

  const deleteGroup = useCallback(
    (groupIndex: number) => {
      const sources = sourceIndicesOf(groupIndex);
      if (sources.length === 0) return;
      setDeleted((current) => new Set([...current, ...sources]));
      setSelected(new Set());
      setHovered(null);
      setStale(true);
    },
    [sourceIndicesOf],
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
        for (const source of sourceIndicesOf(groupIndex)) next[source] = target;
      }
      return next;
    });
    setSelected(new Set());
    setStale(true);
  }, [parsed, selected, groups, assigned, sourceIndicesOf]);

  const resetColors = useCallback(() => {
    setAssigned([]);
    setSelected(new Set());
    // Reset restores deleted layers too: it is the one way back to the artwork
    // as uploaded, and leaving deletions behind would make that a lie.
    setDeleted(new Set());
    setStale(true);
  }, []);

  /*
   * Rebuild automatically when the layer set changes — merging, recolouring or
   * resetting — but only once a mesh already exists.
   *
   * This is a deliberate carve-out from §5.6, not a reversal of it. Merging
   * changes which layers exist and how tall the stack is, so leaving the old
   * mesh on screen shows something that no longer corresponds to the layer
   * list. Dimension edits still wait for the button: they are fiddled with
   * continuously, and each one costs a full retriangulation.
   *
   * generate lives behind a ref so this fires on `assigned` alone. Listing
   * generate as a dependency would re-run it whenever config changed too,
   * which is exactly the reactive behaviour §5.6 rules out.
   */
  const generateRef = useRef(generate);
  useEffect(() => {
    generateRef.current = generate;
  }, [generate]);

  useEffect(() => {
    if (!autoBuild || !effective) return;
    setAutoBuild(false);
    generateRef.current();
  }, [autoBuild, effective]);

  const didMountAssigned = useRef(false);
  useEffect(() => {
    if (!didMountAssigned.current) {
      didMountAssigned.current = true;
      return;
    }
    // Opening a project also replaces `assigned`. The autoBuild effect above
    // already covers that case; building here too would do the work twice.
    if (autoBuild) return;
    if (groupRef.current) generateRef.current();
  }, [assigned, deleted, autoBuild]);

  /*
   * Open a saved project from ?project=<id>.
   *
   * A query parameter rather than router state so the URL survives a refresh
   * and can be shared between the projects list and a bookmark.
   */
  const requestedProject = searchParams.get('project');
  useEffect(() => {
    if (!requestedProject || requestedProject === projectId) return;

    // Wait for the session before deciding; on first paint `user` is null
    // simply because auth has not resolved yet.
    if (authLoading) return;
    if (!user) {
      // The rules would reject this read anyway. Say what to do instead of
      // firing a request that can only fail.
      setError('Sign in to open a saved project.');
      return;
    }

    let cancelled = false;

    setBusy(true);
    void (async () => {
      try {
        const project = await loadProject(requestedProject);
        if (cancelled) return;
        if (!project) {
          setError('That project could not be found.');
          return;
        }

        const restored = parseSvgLayers(project.svg);
        setParsed(restored);
        setSvgText(project.svg);
        setProjectId(project.id);
        setProjectName(project.name);
        setFileName(`${project.name}.svg`);
        setConfig({
          widthMm: project.config.widthMm,
          baseMm: project.config.baseMm,
          layerMm: project.config.layerMm,
          // Absent on projects saved before flat mode shipped, which were
          // stepped by definition.
          flatMode: project.config.flatMode ?? false,
          flatGapMm: project.config.flatGapMm ?? DEFAULT_FLAT_GAP_MM,
          // Absent on projects saved before cropping existed: they were whole.
          crop: project.config.cropRect ?? FULL_CROP,
        });
        /*
         * Assignments are matched by original colour, not by index: a saved
         * project re-parsed by a newer version could produce layers in a
         * different order, and positional restore would then recolour the
         * wrong regions.
         */
        const byOriginal = new Map(
          project.config.layers.map((layer) => [layer.originalColor, layer.assignedColor]),
        );
        setAssigned(restored.layers.map((layer) => byOriginal.get(layer.color) ?? layer.color));

        const removedColors = new Set(
          project.config.layers.filter((l) => l.deleted).map((l) => l.originalColor),
        );
        setDeleted(
          new Set(
            restored.layers
              .map((layer, i) => (removedColors.has(layer.color) ? i : -1))
              .filter((i) => i >= 0),
          ),
        );
        setSelected(new Set());
        setStats(null);
        setStale(false);
        setError(null);
        /*
         * A reopened project arrives with a configuration its owner already
         * settled on, so showing an empty viewport and asking them to press
         * Generate is busywork. §5.6 exists to avoid rebuilding on every
         * config fiddle, which this is not.
         */
        setAutoBuild(true);
      } catch (cause) {
        if (!cancelled) setError(describeFirestoreError(cause, 'Opening that project'));
        console.error('Project load failed', cause);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedProject, projectId, user, authLoading]);

  const save = useCallback(async () => {
    if (!parsed || !svgText || !user) return;
    setSaving(true);
    setError(null);

    try {
      const colors = parsed.layers.map((layer, i) => assigned[i] ?? layer.color);
      const thumbnailDataUrl = await renderThumbnail(parsed, colors);

      const id = await saveProject({
        id: projectId ?? undefined,
        ownerUid: user.uid,
        name: projectName.trim() || 'Untitled sign',
        svg: svgText,
        thumbnailDataUrl,
        config: {
          widthMm: config.widthMm,
          baseMm: config.baseMm,
          layerMm: config.layerMm,
          flatMode: config.flatMode ?? false,
          flatGapMm: config.flatGapMm ?? DEFAULT_FLAT_GAP_MM,
          cropRect: config.crop ?? FULL_CROP,
          layers: parsed.layers.map((layer, i) => ({
            originalColor: layer.color,
            assignedColor: colors[i],
            ...(deleted.has(i) ? { deleted: true } : {}),
          })),
        },
      });

      setProjectId(id);
      setSavedAt(Date.now());
      // Reflect the id in the URL so a refresh reopens what is on screen.
      setSearchParams({ project: id }, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ProjectTooLargeError
          ? cause.message
          : describeFirestoreError(cause, 'Saving that project'),
      );
      console.error('Project save failed', cause);
    } finally {
      setSaving(false);
    }
  }, [parsed, svgText, user, assigned, deleted, projectId, projectName, config, setSearchParams]);

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
                  label={config.flatMode ? 'Colour thickness' : 'Layer step'}
                  unit="mm"
                  min={0.1}
                  max={20}
                  step={0.1}
                  hint={
                    config.flatMode
                      ? 'Height of every colour above the base.'
                      : 'Added per layer above the base.'
                  }
                  value={config.layerMm}
                  onChange={(layerMm) => update({ layerMm })}
                />

                <div className="flex flex-col gap-3 border-t border-rule pt-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={config.flatMode ?? false}
                      onChange={(e) => update({ flatMode: e.target.checked })}
                      className="mt-0.5 size-3.5 shrink-0 accent-signal"
                    />
                    <span>
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-chalk">
                        Flat mesh
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-graphite">
                        One height for every colour, separated by a channel instead of steps.
                      </span>
                    </span>
                  </label>

                  {config.flatMode && (
                    <NumberField
                      label="Channel"
                      unit="mm"
                      min={0.02}
                      max={2}
                      step={0.02}
                      hint="Gap milled between touching colours."
                      value={config.flatGapMm ?? DEFAULT_FLAT_GAP_MM}
                      onChange={(flatGapMm) => update({ flatGapMm })}
                    />
                  )}
                </div>
              </div>
            </Panel>

            {/* Sits directly above the layer list so hovering a row highlights
                the region right next to it, rather than across the screen. */}
            <Panel
              title="Artwork"
              actions={
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant={cropping ? 'primary' : 'secondary'}
                    onClick={() => setCropping((on) => !on)}
                  >
                    {cropping ? 'Done' : 'Crop'}
                  </Button>
                  {!isFullCrop(config.crop) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => update({ crop: FULL_CROP })}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              }
            >
              <div className="flex flex-col gap-3">
                {/*
                  The preview stays uncropped while the window is being dragged
                  — the region outside is what you are choosing against, so it
                  has to remain visible. Everything downstream uses the crop.
                */}
                {/*
                  The box carries the artwork's own aspect so the SVG fills it
                  exactly. Left to letterbox inside a fixed-height container,
                  the overlay's fractions would be of the container while the
                  artwork occupied only part of it — every crop would then be
                  read against the wrong rectangle.
                */}
                <div
                  className="relative mx-auto w-full"
                  style={{ aspectRatio: `${parsed.width} / ${parsed.height}` }}
                >
                  {effective && (
                    <ArtworkPreview
                      parsed={cropping ? parsed : effective}
                      colors={cropping ? assignedColors : undefined}
                      highlightIndex={cropping ? null : hovered}
                    />
                  )}
                  {cropping && (
                    <CropOverlay
                      value={config.crop ?? FULL_CROP}
                      onChange={(crop) => update({ crop })}
                      aspect={parsed.width / parsed.height}
                      lockAspect={lockAspect}
                    />
                  )}
                </div>

                {cropping && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={lockAspect}
                      onChange={(e) => setLockAspect(e.target.checked)}
                      className="size-3.5 shrink-0 accent-signal"
                    />
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
                      Lock to square
                    </span>
                  </label>
                )}
              </div>
            </Panel>

            <Panel
              title={`Layers · ${layers.length}`}
              description="Lowest first. Recolor, delete, or select two or more to merge."
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
                  {(assigned.length > 0 || deleted.size > 0) && (
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

                      <button
                        type="button"
                        aria-label={`Delete layer ${layer.color}`}
                        title="Remove this layer from the sign"
                        // Deleting the last layer would leave nothing to print.
                        disabled={layers.length <= 1}
                        onClick={() => deleteGroup(i)}
                        className={cn(
                          'shrink-0 rounded-[2px] p-1 text-graphite transition-colors',
                          'hover:bg-danger/10 hover:text-danger',
                          'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-graphite',
                        )}
                      >
                        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                          <path
                            d="M2 2l8 8M10 2l-8 8"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                        </svg>
                      </button>
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
                onClick={() =>
                  group &&
                  download3mf(group, threeMfFilename(stlFilename(fileName ?? 'sign')), slots)
                }
              >
                Download 3MF
              </Button>
              <Button
                variant="secondary"
                disabled={!group}
                onClick={() => group && downloadStl(group, stlFilename(fileName ?? 'sign'))}
              >
                Download STL
              </Button>
              <NumberField
                label="Filament slots"
                min={1}
                max={16}
                step={1}
                value={slots}
                hint="How many filaments your printer can load."
                onChange={setSlots}
              />

              {layers.length > slots ? (
                /*
                 * A slicer collapses colours it has no slot for, and picks which
                 * ones on its own. Saying so here is the difference between a
                 * deliberate merge and a surprise at the printer.
                 */
                <p className="border-l-2 border-danger pl-3 text-sm leading-relaxed text-danger">
                  {layers.length} layers but {slots} slots. Your slicer will collapse the
                  extra colours on its own — merge or delete layers down to {slots} to
                  choose which.
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-graphite">
                  3MF keeps the colours, the slot assignments and the alignment. STL is a
                  single uncoloured solid, for tools that need it.
                </p>
              )}
            </div>

            <Panel title={projectId ? 'Saved project' : 'Save project'}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="project-name"
                    className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite"
                  >
                    Name
                  </label>
                  <input
                    id="project-name"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Untitled sign"
                    className="h-10 rounded-[3px] border border-rule bg-mat px-3 text-sm text-chalk outline-none placeholder:text-graphite/50 focus:border-rule-strong"
                  />
                </div>

                <Button
                  variant="secondary"
                  disabled={!user || saving}
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : projectId ? 'Save changes' : 'Save project'}
                </Button>

                {!user ? (
                  <p className="text-sm leading-relaxed text-graphite">
                    <Link
                      to="/login"
                      className="text-chalk underline underline-offset-4 hover:text-signal"
                    >
                      Sign in
                    </Link>{' '}
                    to save. The editor and STL export work without an account.
                  </p>
                ) : savedAt ? (
                  <p className="font-mono text-[11px] text-graphite">
                    Saved {new Date(savedAt).toLocaleTimeString()}
                  </p>
                ) : null}
              </div>
            </Panel>
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
              <Viewer ref={viewerRef} group={group} highlightIndex={hovered} className="size-full" />

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
                {stats.width.toFixed(0)} × {stats.height.toFixed(1)} × {stats.depth.toFixed(2)} mm
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
