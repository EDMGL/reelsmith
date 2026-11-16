/**
 * Extension registries: the ONLY way feature packages plug into the app shell.
 *
 * Every `register*` function returns an `Unregister` callback (handy for tests
 * and hot reload). Registering an existing id replaces the previous entry.
 * Feature packages call these from their `register()` export in
 * `src/features/<name>/index.ts`, which `src/app/registerFeatures.ts` invokes
 * once at startup — before the first render.
 *
 * Components may be plain components or `React.lazy(() => import(...))`
 * components: the shell renders every registered component inside
 * `<Suspense>` (and an error boundary), so feature UIs can be code-split.
 */
import { useSyncExternalStore, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import type { EditorState } from './store';
import type { ClipOf, ClipType, Id, MediaAsset, Project, Track } from './types';

export type Unregister = () => void;

/** A component or a React.lazy component (rendered inside Suspense by the shell). */
export type MaybeLazy<P> = ComponentType<P> | LazyExoticComponent<ComponentType<P>>;

// ---------------------------------------------------------------------------
// Generic observable registry
// ---------------------------------------------------------------------------

/** Ordered keyed registry with change notifications (useSyncExternalStore-friendly). */
export class Registry<T extends { id: string; order?: number }> {
  private items = new Map<string, T>();
  private listeners = new Set<() => void>();
  private snapshot: readonly T[] = [];

  register(item: T): Unregister {
    this.items.set(item.id, item);
    this.emit();
    return () => {
      if (this.items.get(item.id) === item) {
        this.items.delete(item.id);
        this.emit();
      }
    };
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /** Items sorted by `order` (default 100), then insertion order. Stable reference until changed. */
  list = (): readonly T[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  clear(): void {
    this.items.clear();
    this.emit();
  }

  private emit() {
    const arr = [...this.items.values()];
    this.snapshot = arr
      .map((item, i) => ({ item, i }))
      .sort((a, b) => (a.item.order ?? 100) - (b.item.order ?? 100) || a.i - b.i)
      .map((x) => x.item);
    this.listeners.forEach((l) => l());
  }
}

/** React hook: current items of a registry, re-rendering on change. */
export function useRegistry<T extends { id: string; order?: number }>(registry: Registry<T>): readonly T[] {
  return useSyncExternalStore(registry.subscribe, registry.list, registry.list);
}

// ---------------------------------------------------------------------------
// Clip renderers (canvas drawing; used by the compositor (P2) and export (P4))
// ---------------------------------------------------------------------------

/** 2D context type accepted by renderers (works in workers via OffscreenCanvas). */
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A drawable frame of an asset with its intrinsic pixel size. */
export interface AssetFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Environment passed to clip renderers by whoever composites a frame
 * (the engine for preview, the exporter for export).
 */
export interface RenderEnv {
  project: Project;
  /** Track the clip lives on. */
  track: Track;
  /** Logical canvas size = project.width/height. Renderers ALWAYS draw in these coordinates. */
  canvasWidth: number;
  canvasHeight: number;
  /** Project (timeline) time of the frame being rendered, seconds. */
  time: number;
  /** True when rendering for export (renderers may choose higher quality). */
  isExport: boolean;
  getAsset(assetId: Id): MediaAsset | undefined;
  /**
   * Returns the decoded frame of an asset at a SOURCE time (seconds into the
   * file; ignored for images), or null if not available yet. Implemented by the
   * engine, which guarantees frames are ready before calling renderers
   * (`renderFrame` awaits decoding, then calls renderers synchronously).
   */
  getAssetFrame(assetId: Id, sourceTime: number): AssetFrame | null;
}

/**
 * Draws one clip at `localTime` (seconds since `clip.start`, 0 <= localTime < duration).
 *
 * Division of responsibility:
 * - The CALLER (compositor) does `ctx.save()`/`restore()`, sets
 *   `ctx.globalAlpha = clipOpacityAt(clip, localTime)` (transform opacity x
 *   fades), applies effects, and sets a base transform mapping the logical
 *   canvas (env.canvasWidth x env.canvasHeight) onto the real target.
 * - The RENDERER draws the content with its geometry (`clip.transform`,
 *   use `drawWithTransform()` from `src/core/render`). It must be synchronous,
 *   must not clear the canvas and must not reset globalAlpha (multiply only).
 */
export type ClipRenderer<T extends ClipType = ClipType> = (
  ctx: Canvas2D,
  clip: ClipOf<T>,
  localTime: number,
  env: RenderEnv,
) => void;

interface RendererEntry {
  id: ClipType;
  renderer: ClipRenderer<ClipType>;
}
export const clipRendererRegistry = new Registry<RendererEntry>();

/**
 * Registers the canvas renderer for a clip type (one per type; last wins).
 * Ownership: 'video' -> P2, 'image' / 'text' / 'subtitle' -> P3. 'audio' has none.
 */
export function registerClipRenderer<T extends ClipType>(type: T, renderer: ClipRenderer<T>): Unregister {
  return clipRendererRegistry.register({ id: type, renderer: renderer as unknown as ClipRenderer<ClipType> });
}

/** Looks up the renderer for a clip type (undefined if none registered). */
export function getClipRenderer<T extends ClipType>(type: T): ClipRenderer<T> | undefined {
  return clipRendererRegistry.get(type)?.renderer as ClipRenderer<T> | undefined;
}

// ---------------------------------------------------------------------------
// Left panel tabs
// ---------------------------------------------------------------------------

export interface PanelDefinition {
  /** Unique id, e.g. "text", "effects". The media library uses "media". */
  id: string;
  /** Tab label. */
  title: string;
  /** Small icon (emoji / inline SVG element). */
  icon?: ReactNode;
  /** Panel body; fills the left panel. May be React.lazy. */
  component: MaybeLazy<object>;
  /** Tab order (lower first, default 100). Media library is 0. */
  order?: number;
}
export const panelRegistry = new Registry<PanelDefinition>();

/** Adds a tab to the left panel. */
export function registerPanel(def: PanelDefinition): Unregister {
  return panelRegistry.register(def);
}

// ---------------------------------------------------------------------------
// Inspectors (right panel)
// ---------------------------------------------------------------------------

export interface InspectorProps<T extends ClipType = ClipType> {
  /** The clip being shown. With several clips selected: the first selected clip this section applies to. */
  clip: ClipOf<T>;
  track: Track;
  project: Project;
  /**
   * Every selected clip this section applies to (`clip` first). Undefined or
   * `[clip.id]` for a single selection. Only sections registered with
   * `multi: true` are shown for multiple clips; they should apply edits to all
   * of these (see `inspectorTargets`).
   */
  targets?: readonly Id[];
}

/** The clip ids an inspector edit should apply to. */
export function inspectorTargets(props: Pick<InspectorProps, 'clip' | 'targets'>): readonly Id[] {
  return props.targets && props.targets.length > 0 ? props.targets : [props.clip.id];
}

export interface InspectorDefinition {
  id: string;
  /** Section heading. */
  title: string;
  /** Clip types this section applies to; '*' = all. */
  clipTypes: readonly ClipType[] | '*';
  component: MaybeLazy<InspectorProps<ClipType>>;
  /** Section order, lower first (default 100). The core "Clip" timing section is 0. */
  order?: number;
  /** Also shown when several clips are selected (edits apply to all of them). */
  multi?: boolean;
}
export const inspectorRegistry = new Registry<InspectorDefinition>();

/**
 * Registers an inspector section shown in the right panel when exactly one
 * clip of a matching type is selected. Several sections can match one clip
 * type; they are stacked by `order`.
 *
 * @example registerInspector('text', TextInspector, { title: 'Text' })
 * @example registerInspector(['video', 'image'], EffectsInspector, { id: 'effects', title: 'Effects', order: 50 })
 */
export function registerInspector<T extends ClipType>(
  clipType: T | readonly T[] | '*',
  component: MaybeLazy<InspectorProps<T>>,
  opts: { id?: string; title?: string; order?: number; multi?: boolean } = {},
): Unregister {
  const clipTypes = clipType === '*' ? '*' : Array.isArray(clipType) ? (clipType as readonly T[]) : [clipType as T];
  const id = opts.id ?? `inspector:${clipTypes === '*' ? '*' : clipTypes.join(',')}`;
  return inspectorRegistry.register({
    id,
    title: opts.title ?? 'Properties',
    clipTypes,
    component: component as unknown as MaybeLazy<InspectorProps<ClipType>>,
    order: opts.order,
    multi: opts.multi,
  });
}

/** Inspector sections applicable to a clip type, in display order. */
export function getInspectorsFor(type: ClipType): InspectorDefinition[] {
  return inspectorRegistry.list().filter((d) => d.clipTypes === '*' || d.clipTypes.includes(type));
}

// ---------------------------------------------------------------------------
// Toolbar actions
// ---------------------------------------------------------------------------

export type ToolbarLocation = 'topbar' | 'timeline';

export interface ToolbarAction {
  id: string;
  /** 'topbar': right side of the top bar (Export lives here). 'timeline': timeline toolbar. */
  location: ToolbarLocation;
  label: string;
  icon?: ReactNode;
  /** Tooltip. */
  title?: string;
  /** 'primary' renders an accent button (use for Export). */
  variant?: 'default' | 'primary';
  order?: number;
  /** Click handler (read/write state via `useEditorStore.getState()`). */
  run?: () => void | Promise<void>;
  /** Evaluated on each store change; button disabled when false. */
  isEnabled?: (state: EditorState) => boolean;
  /** Fully custom element instead of a button (e.g. a dropdown). May be React.lazy. */
  component?: MaybeLazy<object>;
}
export const toolbarRegistry = new Registry<ToolbarAction>();

/** Adds a button (or custom component) to the top bar or the timeline toolbar. */
export function registerToolbarAction(action: ToolbarAction): Unregister {
  return toolbarRegistry.register(action);
}

// ---------------------------------------------------------------------------
// Timeline overlays
// ---------------------------------------------------------------------------

export interface TrackLayout {
  trackId: Id;
  /** Top of the track row in px, relative to the overlay's top (first track row). */
  top: number;
  height: number;
}

export interface TimelineOverlayProps {
  /** Current zoom, pixels per second. */
  pxPerSecond: number;
  /** Seconds -> x px inside the overlay (= `timeToPx(t, pxPerSecond)`). */
  timeToPx: (seconds: number) => number;
  pxToTime: (px: number) => number;
  /** Total scrollable content size covered by the overlay. */
  width: number;
  height: number;
  /** Vertical layout of the visible track rows, in display order (top first). */
  tracks: readonly TrackLayout[];
}

export interface TimelineOverlayDefinition {
  id: string;
  component: MaybeLazy<TimelineOverlayProps>;
  order?: number;
}
export const timelineOverlayRegistry = new Registry<TimelineOverlayDefinition>();

/**
 * Draws a layer over the timeline track area. The overlay is absolutely
 * positioned over the scrolling content (x=0 is time 0, it scrolls with the
 * clips) and has `pointer-events: none`; set `pointer-events: auto` on
 * elements that need interaction.
 */
export function registerTimelineOverlay(
  component: MaybeLazy<TimelineOverlayProps>,
  opts: { id?: string; order?: number } = {},
): Unregister {
  return timelineOverlayRegistry.register({ id: opts.id ?? `overlay_${timelineOverlayRegistry.list().length}`, component, order: opts.order });
}

// ---------------------------------------------------------------------------
// Preview slot
// ---------------------------------------------------------------------------

export interface PreviewSlotDefinition {
  id: 'preview';
  component: MaybeLazy<object>;
}
export const previewRegistry = new Registry<PreviewSlotDefinition>();

/**
 * Provides the center preview UI (P2). It fills the whole center area and must
 * fit the canvas itself (see `fitRect`). Last registration wins. Until one is
 * registered the shell shows a placeholder box with the project aspect ratio.
 */
export function registerPreview(component: MaybeLazy<object>): Unregister {
  return previewRegistry.register({ id: 'preview', component });
}

// ---------------------------------------------------------------------------
// Preview overlays (DOM layers over the displayed canvas, e.g. transform handles)
// ---------------------------------------------------------------------------

export interface PreviewOverlayProps {
  project: Project;
  /** Size of the displayed canvas rectangle in CSS px. */
  displayWidth: number;
  displayHeight: number;
  /** Display px per project px (= displayWidth / project.width). */
  scale: number;
}

export interface PreviewOverlayDefinition {
  id: string;
  component: MaybeLazy<PreviewOverlayProps>;
  order?: number;
}
export const previewOverlayRegistry = new Registry<PreviewOverlayDefinition>();

/**
 * Adds a DOM layer drawn over the preview frame (e.g. P3's selection and
 * transform handles). Whoever hosts the preview canvas MUST mount
 * `<PreviewOverlayLayer>` (from core) in an element exactly covering the
 * displayed canvas rectangle. Each overlay gets its own absolutely positioned
 * layer (`inset: 0`) stacked by `order`. The layer itself has
 * `pointer-events: none`; overlays opt in with `pointer-events: auto` on the
 * elements that need pointer input. Coordinates: project px x `scale` = layer px.
 */
export function registerPreviewOverlay(
  component: MaybeLazy<PreviewOverlayProps>,
  opts: { id?: string; order?: number } = {},
): Unregister {
  return previewOverlayRegistry.register({
    id: opts.id ?? `preview_overlay_${previewOverlayRegistry.list().length}`,
    component,
    order: opts.order,
  });
}

/** Clears every registry (tests only). */
export function resetRegistries(): void {
  clipRendererRegistry.clear();
  panelRegistry.clear();
  inspectorRegistry.clear();
  toolbarRegistry.clear();
  timelineOverlayRegistry.clear();
  previewRegistry.clear();
  previewOverlayRegistry.clear();
}

