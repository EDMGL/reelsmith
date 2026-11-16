/**
 * SRT / WebVTT parsing and serialization.
 *
 * Times are seconds, rounded to whole milliseconds on parse (both formats
 * carry millisecond precision), so `parse(serialize(cues))` is lossless for
 * millisecond-aligned cues.
 */

export interface Cue {
  /** Seconds. */
  start: number;
  /** Seconds (> start). */
  end: number;
  /** Plain text; lines separated by `\n`. */
  text: string;
  /** Optional word timings, ABSOLUTE seconds (same timebase as start/end). Not written to SRT/VTT. */
  words?: { text: string; start: number; end: number }[];
}

export interface ParseResult {
  cues: Cue[];
  /** Human-readable notes about skipped / repaired blocks. */
  warnings: string[];
}

export type SubtitleFormat = 'srt' | 'vtt';

const roundMs = (s: number) => Math.round(s * 1000) / 1000;

// h:mm:ss,mmm | mm:ss.mmm | h:mm:ss (ms optional; "," or "." separator; 1-3 fraction digits)
const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?`;
const TIMING_RE = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}(?:\s+(.*))?\s*$`);

function toSeconds(h: string | undefined, m: string, s: string, frac: string | undefined): number {
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return roundMs((h ? Number(h) : 0) * 3600 + Number(m) * 60 + Number(s) + ms / 1000);
}

/** Parses one timing line ("00:00:01,000 --> 00:00:02,500 align:start"). Null if not a timing line. */
export function parseTimingLine(line: string): { start: number; end: number } | null {
  const m = TIMING_RE.exec(line);
  if (!m) return null;
  return { start: toSeconds(m[1], m[2]!, m[3]!, m[4]), end: toSeconds(m[5], m[6]!, m[7]!, m[8]) };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'", lrm: '‎', rlm: '‏' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/**
 * Strips formatting markup: HTML-ish SRT tags (<i>, <b>, <u>, <s>, <font …>),
 * VTT tags (<c.cls>, <v Speaker>, <lang en>, <ruby>, <rt>, inline timestamps)
 * and ASS-style overrides ({\an8}). Arbitrary "<" text is preserved.
 */
export function stripTags(text: string): string {
  return text
    // simple tags, optionally with VTT classes: <i>, </b>, <c.yellow.big>, <ruby>, <rt>
    .replace(/<\/?(?:i|b|u|s|c|ruby|rt)(?:\.[\w.-]+)?>/gi, '')
    // tags that carry an annotation/attributes: <v Speaker>, <lang en>, <font color="…">, <span …>
    .replace(/<\/?(?:font|v|lang|span)(?:[.\s][^>]*)?>/gi, '')
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '')
    .replace(/\{\\[^}]*\}/g, '');
}

function normalize(input: string): string {
  return input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Splits into blocks separated by blank (whitespace-only) lines. */
function blocks(input: string): string[][] {
  return normalize(input)
    .split(/\n[ \t]*\n/)
    .map((b) => b.split('\n'))
    .map((lines) => {
      // drop leading/trailing empty lines produced by extra blank lines
      while (lines.length && lines[0]!.trim() === '') lines.shift();
      while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
      return lines;
    })
    .filter((lines) => lines.length > 0);
}

function finishCue(timing: { start: number; end: number }, textLines: string[], label: string, isVtt: boolean, out: ParseResult): void {
  let text = textLines.map((l) => stripTags(l)).join('\n');
  if (isVtt) text = decodeEntities(text);
  else text = text.replace(/&(amp|lt|gt|nbsp);/g, (a) => decodeEntities(a));
  text = text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  if (!(timing.end > timing.start)) {
    out.warnings.push(`${label}: end time is not after start time — skipped.`);
    return;
  }
  if (!text.trim()) {
    out.warnings.push(`${label}: empty text — skipped.`);
    return;
  }
  out.cues.push({ start: timing.start, end: timing.end, text });
}

/** Parses SubRip (.srt). Tolerates BOM, CRLF, missing/garbled indices, '.' ms separators. */
export function parseSrt(input: string): ParseResult {
  const out: ParseResult = { cues: [], warnings: [] };
  blocks(input).forEach((lines, bi) => {
    const ti = lines.findIndex((l) => l.includes('-->'));
    const label = `Block ${bi + 1}`;
    const timing = ti >= 0 && ti <= 1 ? parseTimingLine(lines[ti]!) : null;
    if (!timing) {
      out.warnings.push(`${label}: no valid timing line — skipped.`);
      return;
    }
    finishCue(timing, lines.slice(ti + 1), label, false, out);
  });
  return out;
}

/** Parses WebVTT. Header, NOTE / STYLE / REGION blocks and cue settings are ignored. */
export function parseVtt(input: string): ParseResult {
  const out: ParseResult = { cues: [], warnings: [] };
  const all = blocks(input);
  all.forEach((block, bi) => {
    let lines = block;
    const first = lines[0]!.trim();
    if (bi === 0 && /^WEBVTT(?:\s|$)/.test(first)) {
      // Header metadata is ignored. Be lenient if a cue follows without the required blank line.
      const ti = lines.findIndex((l) => l.includes('-->'));
      if (ti < 0) return;
      lines = lines.slice(ti);
    }
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(first)) return;
    const ti = lines.findIndex((l) => l.includes('-->'));
    const label = `Block ${bi + 1}`;
    const timing = ti >= 0 && ti <= 1 ? parseTimingLine(lines[ti]!) : null;
    if (!timing) {
      out.warnings.push(`${label}: no valid timing line — skipped.`);
      return;
    }
    finishCue(timing, lines.slice(ti + 1), label, true, out);
  });
  return out;
}

/** Guesses the format from a file name and/or the content. */
export function detectFormat(content: string, fileName = ''): SubtitleFormat {
  if (/\.vtt$/i.test(fileName)) return 'vtt';
  if (/\.srt$/i.test(fileName)) return 'srt';
  return /^﻿?WEBVTT/.test(content) ? 'vtt' : 'srt';
}

export function parseSubtitles(content: string, fileName = ''): ParseResult & { format: SubtitleFormat } {
  const format = detectFormat(content, fileName);
  return { format, ...(format === 'vtt' ? parseVtt(content) : parseSrt(content)) };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (VTT). */
export function formatTimestamp(seconds: number, sep: ',' | '.'): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`;
}

/** Short editable form: "MM:SS.mmm" (or "H:MM:SS.mmm" past one hour). */
export function formatClock(seconds: number): string {
  const full = formatTimestamp(seconds, '.');
  return full.startsWith('00:') ? full.slice(3) : full.replace(/^0(\d:)/, '$1');
}

/**
 * Parses user-typed times: "75.5", "1:15.5", "01:15,500", "0:01:15.500".
 * Returns seconds (ms-rounded) or null.
 */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return roundMs(Number(t.replace(',', '.')));
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(t);
  if (!m) return null;
  return toSeconds(m[1], m[2]!, m[3]!, m[4]);
}

/** Cue text cannot contain blank lines (they terminate the block). */
function safeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .join('\n');
}

const sorted = (cues: readonly Cue[]) => [...cues].sort((a, b) => a.start - b.start || a.end - b.end);

export function serializeSrt(cues: readonly Cue[]): string {
  return sorted(cues)
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ',')} --> ${formatTimestamp(c.end, ',')}\n${safeText(c.text)}\n`)
    .join('\n');
}

const escapeVtt = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function serializeVtt(cues: readonly Cue[]): string {
  const body = sorted(cues)
    .map((c) => `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${escapeVtt(safeText(c.text)).replace(/-->/g, '--&gt;')}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function serializeSubtitles(cues: readonly Cue[], format: SubtitleFormat): string {
  return format === 'vtt' ? serializeVtt(cues) : serializeSrt(cues);
}
