/**
 * Drag-and-drop payload conventions shared between the left panels and the
 * timeline (HTML5 DnD).
 */

/** dataTransfer type carrying a media asset id (dragged from the media library). */
export const ASSET_DRAG_MIME = 'application/x-reelsmith-asset';

/**
 * dataTransfer type carrying a JSON-serialized `Clip` template (e.g. a text
 * preset dragged from the text panel). The timeline assigns id/trackId/start
 * on drop and inserts it with `insertClip`.
 */
export const CLIP_TEMPLATE_DRAG_MIME = 'application/x-reelsmith-clip';
