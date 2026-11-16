# Erdemcut

A fully client-side, browser-based video editor (Vite + React + TypeScript + Zustand).

Requires Node 22+ (`nvm use` picks it up from `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit (strict)
npm run test       # vitest run (jsdom)
npm run build      # typecheck + production build
```

The dev and preview servers send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, so the page is **cross-origin isolated**
(`crossOriginIsolated === true`, `SharedArrayBuffer` available for worker/WASM export).
Consequence: **never load anything cross-origin** (no CDN fonts, scripts, images). `blob:` and
`data:` URLs are fine. A static host for the production build must send the same two headers.

## Layout

```
src/
  core/                 P1 — shared contracts (the ONLY thing feature packages import)
  app/                  P1 — shell: layout, top bar, left panel tabs, inspector, preview slot,
                        shortcuts, feature discovery (registerFeatures.ts), main.tsx
  features/media/       P1 — media library (import, probe, thumbnails, waveform)
  features/timeline/    P1 — timeline UI + core "Clip"/"Transform" inspector sections
  engine/               P2 — playback/render engine (implements PlaybackEngine)
  features/preview/     P2 — preview canvas UI (registerPreview)
  features/effects/     P2 — effects definitions, effects panel/inspector
  features/text/        P3 — text clips (renderer, panel, inspector)
  features/overlays/    P3 — image/sticker overlays (image renderer)
  features/subtitles/   P3 — subtitle clips/styles (renderer, panel)
  features/silence/     P4 — silence detection + "Remove silence"
  features/denoise/     noise reduction ("Audio cleanup" inspector section)
  features/voiceover/   microphone voiceover recording ("Voiceover" panel)
  features/export/      P4 — export (toolbar action, encoder)
```

## Contracts for feature packages

### Directory ownership

| Package | Owns (may create/overwrite anything inside) |
|---|---|
| P1 Foundation & Timeline | root config, `src/core/**`, `src/app/**`, `src/features/media/**`, `src/features/timeline/**` |
| P2 Preview engine + effects | `src/engine/**`, `src/features/preview/**`, `src/features/effects/**` |
| P3 Text/image overlays + subtitles | `src/features/text/**`, `src/features/overlays/**`, `src/features/subtitles/**` |
| P4 Silence detection + export | `src/features/silence/**`, `src/features/export/**` |

Rules: import shared things **only from `src/core`** (`import { … } from '../../core'`). Do not import
another package's internals. If you need a new core contract, ask P1 / the lead.

### Getting plugged in: `register()`

`src/app/registerFeatures.ts` auto-discovers `src/engine/index.ts` and every
`src/features/*/index.ts` (via `import.meta.glob`) and calls its exported `register()` once at
startup, before the first render. You never edit app files:

```ts
// src/features/text/index.ts
import { lazy } from 'react';
import { registerPanel, registerInspector, registerClipRenderer } from '../../core';
import { renderText } from './renderText';

export function register(): void {
  registerClipRenderer('text', renderText);
  registerPanel({ id: 'text', title: 'Text', icon: 'T', order: 10,
    component: lazy(() => import('./TextPanel')) });          // default export
  registerInspector('text', lazy(() => import('./TextInspector')), { id: 'text', title: 'Text', order: 20 });
}
```

Every `register*` returns an `Unregister` function. Re-registering the same `id` replaces the
entry. **All registered components may be `React.lazy`** — the shell renders them inside
`<Suspense>` plus an error boundary (`Slot` from core), so code-split freely and a crash in one
feature can't take down the app.

### Data model (`src/core/types.ts`)

- `Project { version, id, name, width, height, fps, aspectPreset, backgroundColor, tracks, clips: Record<id, Clip>, assets: Record<id, MediaAsset>, subtitleStyles }`. Duration is derived: `getProjectDuration(project)`.
- `Track { id, kind: 'video'|'audio'|'overlay'|'text'|'subtitle', name, order, muted, locked, hidden }`.
  `order` ascending = compositing order (0 drawn first/bottom). The timeline lists highest order on top; audio tracks are kept at the low end. Accepted clip types per kind: `TRACK_ACCEPTS` (`video:[video,image]`, `overlay:[video,image,text]`, `audio:[audio]`, `text:[text]`, `subtitle:[subtitle]`).
- `Clip` = discriminated union on `type`: `VideoClip | AudioClip | ImageClip | TextClip | SubtitleClip` (`ClipOf<'text'>` etc.). Common: `id, trackId, start, duration, name, effects: EffectInstance[], fadeIn, fadeOut` (all seconds).
  - video/audio (`MediaSourceFields`): `assetId, sourceIn, sourceOut, speed, volume`. Invariant `duration = (sourceOut - sourceIn) / speed`; source time = `clipSourceTime(clip, t)`. **Video clips carry their own audio** (no separate audio clip is created on import).
  - video/image/text: `transform { x, y, scale, rotation, opacity }` — `x,y` = clip **center** as a fraction of canvas size (0.5/0.5 = centered); `scale` 1 = natural fit (media: contain-fit in canvas; text: multiplies `style.fontSize`); `rotation` degrees clockwise.
  - text: `text, style: TextStyle` (`fontFamily, fontSize, fontWeight, italic, color, stroke, shadow, align, background, lineHeight`; sizes in project px).
  - subtitle: `text, styleId, styleOverride?` → resolve with `resolveSubtitleStyle(project, clip)` (`SubtitleStyle` adds `bottomMargin`, `maxWidth` fractions). `DEFAULT_SUBTITLE_STYLE_ID = 'default'` always exists.
- `EffectInstance { id, effectType, params: Record<string, number|string|boolean>, enabled }` — definitions are P2's.
- `MediaAsset { id, kind, name, mimeType, size, duration (null for images), width, height, hasAudio, thumbnail?, waveform?, status: 'ready'|'missing', objectURL, blob? }`. `objectURL`/`blob` are runtime-only.
- Everything is immutable: produce new objects, never mutate state from the store.
- Factories/helpers: `createTextClip`, `createSubtitleClip`, `createClipFromAsset`, `defaultTransform`, `defaultTextStyle`, `getSortedTracks`, `getTrackClips`, `getActiveClipsAt(project, t)`, `clipOpacityAt`, `clipGainAt`, `fadeFactor`, `isMediaClip`, `isVisualClip`, `hasAsset`, `createId`.

### Store (`useEditorStore`)

Zustand hook; outside React use `useEditorStore.getState()` / `.subscribe()`. Full signatures with
TSDoc are in `src/core/store.ts`. Overview:

- project: `setProjectName`, `setAspectPreset(id)`, `setCanvasSize(w,h)`, `setFps`, `setBackgroundColor`, `loadProject`, `newProject`
- subtitle styles: `updateSubtitleStyle(id, patch) → boolean` — patches `project.subtitleStyles[id]` (id immutable) as one undo step (transaction-aware); returns false with no history entry for an unknown id or an unchanged patch. Resolve fallbacks (e.g. to `DEFAULT_SUBTITLE_STYLE_ID`) before calling. Don't write `project` via `useEditorStore.setState` — use store actions.
- assets: `addAsset`, `updateAsset` (both *not* undo steps), `removeAsset` (undoable, removes its clips)
- tracks: `addTrack(kind, opts?) → id`, `removeTrack`, `updateTrack(id, {name,muted,locked,hidden})`, `moveTrack(id, order)`
- clips: `addClip(clip) → boolean`, `insertClip(clip, {trackId?, start?}) → id|null` (auto-picks or creates a track), `addAssetClip(assetId, opts?)`, `updateClip(id, patch) → boolean`, `removeClips(ids)`, `moveClip(id, start, trackId?) → boolean`, `moveClips(ids, delta) → boolean`, `trimClip(id, 'start'|'end', time) → boolean`, `splitClip(id, t) → newId|null`, `splitAtPlayhead() → ids`, **`rippleDeleteRanges(ranges: {start,end}[], {trackIds?}) → boolean`**, `rippleDeleteClips(ids)`, `duplicateClips(ids) → ids`
- selection/view: `selectedClipIds`, `selectClips(ids, 'replace'|'toggle'|'add')`, `clearSelection`, `selectedTrackId`, `selectTrack`, `zoom` (px per second), `setZoom`
- playback: `currentTime`, `isPlaying`, `seekNonce`, `setCurrentTime(t)` (user seek, bumps `seekNonce`), `setPlaybackTime(t)` (engine only), `play`, `pause`, `togglePlay`
- history: `undo`, `redo`, `canUndo()`, `canRedo()`, `past`, `future`, `beginTransaction(label)`, `commitTransaction()`, `cancelTransaction()`, `transact(label, fn)`

Editing rules (implemented as pure functions in `ops`, exported as `import { ops } from core`):
- **No overlaps on a track: moves/adds/updates that would overlap are rejected** (return `false`/`null`), trims are **clamped** to neighbours, source bounds and a 1-frame minimum.
- Clips on **locked** tracks are never modified (single-clip ops are rejected; multi-clip ops skip them; `rippleDeleteRanges` skips locked tracks).
- `rippleDeleteRanges` merges/sorts ranges, deletes clips fully inside, cuts clips spanning a range (adjusting `sourceIn/Out`; the first piece keeps the id), shifts everything left. Default = all unlocked tracks (keeps A/V in sync). One undo step.
- Each store action = one undo step. Wrap continuous gestures (slider drags, live previews) in `beginTransaction/commitTransaction` (or `transact`) to make them one step.

### Rendering contract (P2 compositor, P3 renderers, P4 export)

```ts
registerClipRenderer<T extends ClipType>(type: T, renderer: ClipRenderer<T>): Unregister
getClipRenderer(type): ClipRenderer | undefined

type ClipRenderer<T> = (ctx: Canvas2D, clip: ClipOf<T>, localTime: number, env: RenderEnv) => void;
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface RenderEnv {
  project; track; canvasWidth; canvasHeight;   // logical canvas = project.width/height
  time;                                         // project time of the frame
  isExport: boolean;
  getAsset(assetId): MediaAsset | undefined;
  getAssetFrame(assetId, sourceTime): { source: CanvasImageSource; width; height } | null;
}
```

- Ownership: `video` → P2, `image`/`text`/`subtitle` → P3. `audio` has no renderer.
- `localTime` = seconds since `clip.start`. Renderers draw synchronously in **logical canvas coordinates**, use `drawWithTransform(ctx, clip.transform, canvasWidth, canvasHeight, draw)` (origin at clip center) and `containSize()`; they must not clear the canvas or reset `globalAlpha`.
- The **caller** (compositor) does save/restore, sets `globalAlpha *= clipOpacityAt(clip, localTime)`, applies effects, maps logical canvas → target size, skips hidden tracks, draws `project.backgroundColor` first and tracks in ascending `order`. `drawClip(ctx, clip, env)` in `core/render.ts` is the reference implementation (without effects).
- `getAssetFrame` is supplied by the engine, which must have decoded the needed frames before invoking renderers.

### Engine contract (P2 implements, P4 consumes)

```ts
interface PlaybackEngine {
  play(): void; pause(): void; seek(t: number): void;
  renderFrame(t: number, targetCtx: Canvas2D, opts?: { isExport?; width?; height? }): Promise<void>;
  mixAudio(opts: { start; end; sampleRate; channels }): Promise<AudioBuffer>;
  dispose(): void;
}
setEngine(engine | null); getEngine(): PlaybackEngine | null; useEngine(); subscribeEngine(fn)
```

The store is the source of truth: the engine subscribes to `isPlaying` and `seekNonce`, advances
time with `setPlaybackTime(t)` while playing and calls the store's `pause()` at the project end.
P4 export uses `getEngine()!.renderFrame(t, ctx, { isExport: true, width, height })` per frame and
`mixAudio` for the soundtrack — never importing `src/engine` directly.

### UI extension points

```ts
registerPanel({ id, title, icon?, component, order? })          // left tabs; media is order 0
registerInspector(clipType | clipType[] | '*', component, { id?, title?, order? })
     // component props: { clip, track, project }; sections stack by order.
     // Core sections: 'core:clip' (order 0, all types), 'core:transform' (order 10, video/image/text).
     // Register the same id to replace a core section.
registerToolbarAction({ id, location: 'topbar'|'timeline', label, icon?, title?, variant?: 'primary',
                        order?, run?, isEnabled?(state), component? })
     // P4: Export -> location 'topbar', variant 'primary'; Remove silence -> location 'timeline'.
registerTimelineOverlay(component, { id?, order? })
     // props: { pxPerSecond, timeToPx, pxToTime, width, height, tracks: {trackId, top, height}[] }
     // Absolutely positioned over the track rows, x = 0 at time 0, scrolls with clips,
     // pointer-events: none (opt in per element).
registerPreview(component)  // P2: fills the center area; fit the canvas with fitRect(); a transport
                            // bar (play/pause/timecode) is rendered by the shell below it.
```

### Active left panel

```ts
openPanel(id: string): void           // show that left-panel tab; unknown (unregistered) ids are ignored
getActivePanelId(): string | null     // currently shown panel id
useActivePanelId(): string | null     // React hook
subscribeActivePanel(fn): () => void  // non-React subscription
```

This is the single source of truth for the left panel's selected tab: the shell's tab buttons
call `openPanel` too. Default (nothing opened yet, or the opened panel was unregistered) is the
first registered panel by `order` (the media library, order 0). Use it e.g. to jump to your panel
after a toolbar action — never click tabs through the DOM. Tab markup stays
`<button role="tab" title="{panel.title}" aria-selected>` .

### Preview overlays (DOM layers over the frame)

```ts
registerPreviewOverlay(component: MaybeLazy<PreviewOverlayProps>, opts?: { id?, order? }): Unregister
interface PreviewOverlayProps {
  project: Project;
  displayWidth: number;   // displayed canvas rectangle, CSS px
  displayHeight: number;
  scale: number;          // display px per project px (displayWidth / project.width)
}
<PreviewOverlayLayer project={project} displayWidth={w} displayHeight={h} />   // from core
```

- Use case: P3 draws selection boxes / transform handles over the preview frame and handles
  pointer input there. Project px → layer px: multiply by `scale` (a clip center is at
  `transform.x * displayWidth, transform.y * displayHeight`).
- **Whoever hosts the preview canvas renders the overlays.** Today that is the shell's placeholder;
  **P2's preview component MUST mount `<PreviewOverlayLayer>`** inside a `position: relative`/`absolute`
  element that exactly covers the displayed canvas rectangle (same box as the canvas, same size
  passed as `displayWidth/Height`). The layer renders each overlay in a `Slot` (Suspense + error
  boundary, lazy-compatible) in its own `position: absolute; inset: 0` div, stacked by `order`.
- The layer has `pointer-events: none`; overlays set `pointer-events: auto` on the elements that
  need input (so clicks elsewhere still reach the preview). Renders nothing when no overlay is
  registered.

Drag & drop: the media library drags `ASSET_DRAG_MIME` (asset id). Panels can drag a JSON
`Clip` template with `CLIP_TEMPLATE_DRAG_MIME`; the timeline assigns id/track/start and calls
`insertClip`.

### Utilities

Time: `secondsToFrames`, `framesToSeconds`, `snapToFrame`, `formatTimecode` (HH:MM:SS:FF), `parseTimecode`, `formatDuration`, `timeToPx(t, pxPerSecond)`, `pxToTime`, `snapTime`, `snapInterval`, `normalizeRanges`, `clamp`, `TIME_EPSILON`.
Aspect: `ASPECT_PRESETS` (9:16 1080×1920, 16:9 1920×1080, 1:1 1080×1080, 4:5 1080×1350, 4:3 1440×1080, 21:9 2520×1080), `fitRect`, `containSize`, `sanitizeCanvasSize` (even, 16..7680).

### Persistence

Autosave (debounced 600 ms) writes the project JSON (minus `blob`/`objectURL`) to `localStorage`
key `erdemcut:project:v1`; asset blobs go to IndexedDB (`erdemcut` / `assets`). On load the project
is restored and object URLs recreated (`status: 'missing'` if a blob is gone). Keep any data you
add to the project JSON-serializable. Undo history is not persisted.

## Silence removal

Silence panel (or **Remove silence** in the timeline toolbar). Pick a style — **Natural** (pauses
≥ 0.7 s, generous padding), **Tight** (≥ 0.4 s) or **Jump cut** (≥ 0.25 s, also drops tiny noises
between words) — and press **Detect silence** to review, or **⚡ Detect & cut** to cut everything at
once. While a result is shown, changing the style/settings re-detects automatically. Each detected
silence can be toggled and auditioned (▶ plays 1 s around it). Cutting is one undo step.

## Noise reduction

Select a video/audio clip → inspector **Audio cleanup** → Light / Medium / Strong → **Reduce noise**.
Removes constant background noise (fan, AC hum, hiss, room tone) by spectral gating
(`src/features/denoise/spectralGate.ts`): the quietest ~15 % of STFT frames give a per-bin noise
profile, bins below `mean + n·std` are attenuated (mask smoothed over ±2 frames × ±2 bins).

Runs in a worker: mediabunny decodes the audio, the cleaned PCM is re-encoded while **video packets
are copied untouched** (no re-encode). The result is a new asset `"<name> (clean).<ext>"`
(`derivedFrom` points at the source) and every clip using the file switches to it in one undo
step. **Re-apply** always starts from the original; **Restore original** switches back.

## Word-highlighted captions

Subtitles panel → **Style (all subtitles)** → **Highlight**: **Color** (spoken word changes color),
**Box** (a colored box moves from word to word) or **Karaoke** (words fill with color as they are
spoken), plus optional **Pop** (active word grows; neighbours move apart so nothing overlaps).

Auto captions use the `whisper-*_timestamped` models with `return_timestamps: 'word'`; words are
grouped into short cues (≤ 32 chars / 4 s, new cue at pauses > 0.6 s and sentence ends,
`wordsToCues`) and stored on the clip as `SubtitleClip.words` (relative to the clip start). Split,
merge and start-edge edits keep the words on the audio. Cues without word timings (manual,
SRT/VTT, edited to a different word count) get timings estimated by word length (`wordTiming.ts`).

## Voiceover

**Voiceover** panel (or 🎙 in the timeline toolbar): pick a microphone, press **● Record** — after an
optional 3-2-1 countdown it records from the playhead while the timeline plays (muted by default,
preview only). **■ Stop**, Space or the end of the timeline ends the take. The take is converted to
WAV (MediaRecorder WebM has no seekable duration), imported as an asset and placed at the start
time on a "Voiceover" audio track (a new "Voiceover N" track if the first is busy); one undo step.

## Auto captions (on-device Whisper)

Subtitles panel → pick a model and language → **Auto captions**. Speech-to-text runs entirely in
the browser via [transformers.js](https://github.com/huggingface/transformers.js) in a worker
(`src/features/subtitles/whisper/`): WebGPU when available, otherwise multi-threaded WASM.
Audio never leaves the machine.

| Model | First download (WebGPU / WASM) | Notes |
|---|---|---|
| Whisper Base | ~210 MB / ~80 MB | fast, fine for clear speech |
| Whisper Small | ~590 MB / ~250 MB | noticeably better Turkish |

- Weights come from the Hugging Face Hub (`onnx-community/whisper-*`, CORS-enabled, so they load
  under COEP) and are cached in Cache Storage; later runs start in seconds. onnxruntime's WASM is
  bundled and served same-origin (no CDN).
- The mixed timeline audio is cut into ≤28 s chunks at the quietest point (`planChunks`), chunks
  below −50 dBFS are skipped (Whisper hallucinates on silence), and long segments are split into
  ≤42-char cues with proportional timing (`segmentsToCues`).
- Other engines can still plug in through `registerTranscriptionProvider`.

## Keyboard shortcuts

**Multi-select:** Shift/⌘-click clips, ⌘/Ctrl+A, or drag a box on empty timeline space (Shift adds
to the selection). With several clips selected, inspector sections registered with
`registerInspector(…, { multi: true })` are shown and receive `targets` (all selected clip ids they
apply to; use `inspectorTargets(props)`): Clip (volume, fades), Transform, Placement and Effects
edit every selected clip in one undo step (`store.updateClips`).


Space play/pause · S split at playhead · Del/Backspace delete · Shift+Del ripple delete ·
⌘/Ctrl+Z undo · ⇧⌘/Ctrl+Shift+Z or Ctrl+Y redo · ⌘/Ctrl+D duplicate · ⌘/Ctrl+A select all · ←/→ one frame (Shift: 1 s) ·
Home start · +/- zoom · ⌘/Ctrl+wheel zoom at cursor · Alt while dragging toggles snapping · Esc clear selection.
