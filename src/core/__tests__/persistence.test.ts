import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '../persistence';
import { makeProject, videoClip, withClips } from './fixtures';

describe('serialization', () => {
  it('strips runtime fields and restores them from blobs', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'c', v, 0));
    p.assets.asset1 = { ...p.assets.asset1!, blob: new Blob(['x']) };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(json.assets.asset1.objectURL).toBeUndefined();
    expect(json.assets.asset1.blob).toBeUndefined();

    const restored = deserializeProject(json, new Map([['asset1', new Blob(['x'])]]), () => 'blob:new')!;
    expect(restored.assets.asset1!.objectURL).toBe('blob:new');
    expect(restored.assets.asset1!.status).toBe('ready');
    expect(restored.clips.c).toEqual(p.clips.c);

    const missing = deserializeProject(json, new Map(), () => 'x')!;
    expect(missing.assets.asset1!.status).toBe('missing');
    expect(deserializeProject({ foo: 1 }, new Map())).toBeNull();
  });
});
