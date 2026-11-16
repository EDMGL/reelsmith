import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  formatClock,
  formatTimestamp,
  parseClock,
  parseSrt,
  parseSubtitles,
  parseVtt,
  serializeSrt,
  serializeVtt,
  stripTags,
  type Cue,
} from '../formats';

const CUES: Cue[] = [
  { start: 0, end: 1.5, text: 'Hello' },
  { start: 1.5, end: 3.001, text: 'Two\nlines' },
  { start: 61.25, end: 62.999, text: 'Special: a < b & c > d, “quotes”, émoji 🎬' },
  { start: 3725.007, end: 3726, text: 'Past one hour -- and "-->" inside' },
  { start: 360000.5, end: 360001, text: 'Hundred hours' },
];

describe('timestamps', () => {
  it('formats with both separators', () => {
    expect(formatTimestamp(3725.007, ',')).toBe('01:02:05,007');
    expect(formatTimestamp(0.9995, '.')).toBe('00:00:01.000');
    expect(formatTimestamp(360000.5, '.')).toBe('100:00:00.500');
  });
  it('clock parse/format for the cue editor', () => {
    expect(formatClock(65.5)).toBe('01:05.500');
    expect(formatClock(3725.007)).toBe('1:02:05.007');
    expect(parseClock('01:05.500')).toBe(65.5);
    expect(parseClock('1:02:05,007')).toBe(3725.007);
    expect(parseClock('75.25')).toBe(75.25);
    expect(parseClock('1:5')).toBe(65);
    expect(parseClock('abc')).toBeNull();
  });
});

describe('round trips are lossless (timing + text)', () => {
  it('SRT', () => {
    const r = parseSrt(serializeSrt(CUES));
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual(CUES);
  });
  it('VTT (escapes & < > and "-->")', () => {
    const out = serializeVtt(CUES);
    expect(out.startsWith('WEBVTT\n\n')).toBe(true);
    expect(out).toContain('a &lt; b &amp; c &gt; d');
    expect(out).not.toMatch(/inside.*-->/);
    const r = parseVtt(out);
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual(CUES);
  });
  it('serializers sort cues and renumber SRT', () => {
    const srt = serializeSrt([CUES[1]!, CUES[0]!]);
    expect(srt.split('\n').slice(0, 3)).toEqual(['1', '00:00:00,000 --> 00:00:01,500', 'Hello']);
  });
  it('blank lines inside cue text are removed so they cannot break blocks', () => {
    const r = parseSrt(serializeSrt([{ start: 0, end: 1, text: 'a\n\n b' }]));
    expect(r.cues).toEqual([{ start: 0, end: 1, text: 'a\n b' }]);
  });
});

describe('nasty SRT input', () => {
  it('BOM, CRLF, "." separators, missing index, extra blank lines, tags, multi-line', () => {
    const src =
      '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> <font color="#ff0">world</font>\r\nsecond line\r\n\r\n\r\n\r\n' +
      '00:00:03.000 --> 00:00:04.000\r\n{\\an8}Top text\r\n\r\n' +
      '3\r\n0:00:05,5 --> 0:00:06,25   \r\nShort ms\r\n';
    const r = parseSrt(src);
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual([
      { start: 1, end: 2.5, text: 'Hello world\nsecond line' },
      { start: 3, end: 4, text: 'Top text' },
      { start: 5.5, end: 6.25, text: 'Short ms' },
    ]);
  });
  it('skips malformed blocks with warnings', () => {
    const r = parseSrt('1\nnot a time\ntext\n\n2\n00:00:02,000 --> 00:00:01,000\nbackwards\n\n3\n00:00:03,000 --> 00:00:04,000\n\n4\n00:00:05,000 --> 00:00:06,000\nok\n');
    expect(r.cues).toEqual([{ start: 5, end: 6, text: 'ok' }]);
    expect(r.warnings).toHaveLength(3);
  });
  it('old Mac CR line endings', () => {
    expect(parseSrt('1\r00:00:00,000 --> 00:00:01,000\rA\r\r2\r00:00:01,000 --> 00:00:02,000\rB').cues.map((c) => c.text)).toEqual(['A', 'B']);
  });
  it('keeps literal "<" text that is not a tag', () => {
    expect(stripTags('if a <b and c> d')).toBe('if a <b and c> d');
    expect(stripTags('<b>bold</b> <c.yellow>x</c> <v Bob>hi</v> <00:00:01.500>t')).toBe('bold x hi t');
  });
});

describe('nasty VTT input', () => {
  it('header metadata, NOTE/STYLE/REGION, cue ids, settings, mm:ss timings, entities, voice tags', () => {
    const src = [
      '﻿WEBVTT - Some title',
      'Kind: captions',
      'Language: en',
      '',
      'STYLE',
      '::cue { color: yellow }',
      '',
      'REGION',
      'id:fred width:40%',
      '',
      'NOTE this is a comment',
      'spanning lines',
      '',
      'intro-1',
      '00:01.000 --> 00:02.500 align:start position:10% line:0',
      '<v Roger Bingham>We are in New York City &amp; it&#39;s &lt;great&gt;',
      '',
      '00:00:03.000 --> 00:00:04.000',
      '<c.loud>Line one</c>',
      '<i>Line two</i>',
      '',
      'NOTE trailing note',
      '',
    ].join('\r\n');
    const r = parseVtt(src);
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual([
      { start: 1, end: 2.5, text: "We are in New York City & it's <great>" },
      { start: 3, end: 4, text: 'Line one\nLine two' },
    ]);
  });
  it('tolerates a cue right after the header line without a blank line, and "," ms', () => {
    const r = parseVtt('WEBVTT\n00:00:00,500 --> 00:00:01,000\nhi\n');
    expect(r.cues).toEqual([{ start: 0.5, end: 1, text: 'hi' }]);
  });
});

describe('format detection', () => {
  it('by extension, then by content', () => {
    expect(detectFormat('', 'a.VTT')).toBe('vtt');
    expect(detectFormat('WEBVTT', 'a.srt')).toBe('srt');
    expect(detectFormat('﻿WEBVTT\n')).toBe('vtt');
    expect(detectFormat('1\n00:00:00,000 --> 00:00:01,000\nx')).toBe('srt');
    expect(parseSubtitles('WEBVTT\n\n00:00.000 --> 00:01.000\nx').format).toBe('vtt');
  });
});
