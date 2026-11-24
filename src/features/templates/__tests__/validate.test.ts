import { describe, expect, it } from 'vitest';
import { findBuiltinTemplate } from '../catalogue';
import { TEMPLATE_FORMAT_VERSION, type VideoTemplate } from '../types';
import { parseTemplateFile, templateToFile, validateTemplate } from '../validate';

const good = (): VideoTemplate => ({
  formatVersion: TEMPLATE_FORMAT_VERSION,
  id: 'x',
  name: 'X',
  category: 'Test',
  description: '',
  aspect: '1:1',
  duration: 4,
  slots: [
    { id: 'a', start: 0, duration: 2, accepts: 'any', layer: 0, fit: 'cover', effects: [{ effectType: 'blur', params: { amount: 4 } }] },
    { id: 'b', start: 2, duration: 2, accepts: 'image', layer: 0, fit: 'contain', motion: { preset: 'zoom-in' } },
  ],
  texts: [{ id: 't', label: 'Title', text: 'Hi', start: 0, duration: 4, style: { fontSize: 80, stroke: null }, x: 0.5, y: 0.5, editable: true }],
  music: { trackId: 'lofi-lazy-sunday', seed: 101, volume: 0.5 },
});

const errorsOf = (data: unknown) => {
  const v = validateTemplate(data);
  return v.ok ? [] : v.errors;
};

describe('validateTemplate', () => {
  it('accepts a valid template and returns an equal, fresh object', () => {
    const t = good();
    const v = validateTemplate(t);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.template).toEqual(t);
      expect(v.template).not.toBe(t);
    }
  });

  it('strips unknown fields (never trusts input blindly)', () => {
    const t = { ...good(), evil: '<script>', slots: [{ ...good().slots[0], onload: 'x', __proto__: { polluted: true } }] };
    const v = validateTemplate(JSON.parse(JSON.stringify(t)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect('evil' in v.template).toBe(false);
    expect('onload' in v.template.slots[0]!).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ['not an object', 42, /must be an object/],
    ['wrong version', { ...good(), formatVersion: 99 }, /unsupported version/],
    ['no slots', { ...good(), slots: [] }, /at least one media slot/],
    ['negative duration', { ...good(), slots: [{ ...good().slots[0], duration: -1 }] }, /slots\[0\]\.duration/],
    ['NaN start', { ...good(), slots: [{ ...good().slots[0], start: 'soon' }] }, /slots\[0\]\.start: must be a number/],
    ['bad accepts', { ...good(), slots: [{ ...good().slots[0], accepts: 'pdf' }] }, /accepts: must be one of/],
    ['unknown effect', { ...good(), slots: [{ ...good().slots[0], effects: [{ effectType: 'melt', params: {} }] }] }, /unknown effect “melt”/],
    ['unknown music', { ...good(), music: { trackId: 'nope', seed: 1, volume: 1 } }, /unknown music track/],
    ['bad aspect', { ...good(), aspect: '3:7' }, /aspect: must be one of/],
    ['slot after the end', { ...good(), duration: 3 }, /after the template end/],
    ['overlap on a layer', { ...good(), slots: [good().slots[0], { ...good().slots[1], start: 1 }] }, /overlap in time/],
    ['duplicate ids', { ...good(), slots: [good().slots[0], { ...good().slots[1], id: 'a' }] }, /used twice/],
    ['huge name', { ...good(), name: 'x'.repeat(500) }, /too long/],
    ['bad color', { ...good(), texts: [{ ...good().texts[0], style: { color: 'red;}body{' } }] }, /not allowed/],
    ['copy on own layer', { ...good(), slots: [{ ...good().slots[0], copies: [{ layer: 0, fit: 'cover' }] }, good().slots[1]] }, /same layer/],
  ])('rejects %s with a readable message', (_n, data, re) => {
    const errors = errorsOf(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(re);
  });

  it('parses exported files and bare templates; rejects other JSON', () => {
    const t = findBuiltinTemplate('featured-beat-flip')!;
    const v = parseTemplateFile(JSON.stringify(templateToFile(t)));
    expect(v.ok && v.template.id).toBe(t.id);
    expect(parseTemplateFile(JSON.stringify(good())).ok).toBe(true);
    expect(parseTemplateFile('{nope').ok ? [] : (parseTemplateFile('{nope') as { errors: string[] }).errors).toEqual(['The file is not valid JSON.']);
    const other = parseTemplateFile(JSON.stringify({ kind: 'something-else', template: good() }));
    expect(other.ok).toBe(false);
    expect(other.ok ? '' : other.errors[0]).toMatch(/not an Erdemcut template/);
  });
});
