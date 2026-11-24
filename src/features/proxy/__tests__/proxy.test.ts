import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializeProject, useEditorStore, type MediaAsset } from '../../../core';
import { makeAsset, makeProject } from '../../../core/__tests__/fixtures';
import { previewUrl } from '../../../engine/engine';
import { proxyDeps, pruneProxies, resetProxiesForTests, startProxies, useProxyStore, type ProxyDeps } from '../proxyManager';

const S = () => useEditorStore.getState();
const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const original: ProxyDeps = { ...proxyDeps };
let cache: Map<string, Blob>;
let builds: string[];
let stop: (() => void) | null = null;
let pendingBuild: { resolve: (b: Blob) => void; reject: (e: unknown) => void; progress: (f: number) => void } | null;

function video(id: string): MediaAsset {
  return { ...makeAsset(id), blob: new Blob([id]) };
}

beforeEach(() => {
  resetProxiesForTests();
  cache = new Map();
  builds = [];
  pendingBuild = null;
  Object.assign(proxyDeps, {
    cache: {
      get: async (k: string) => cache.get(k),
      put: async (k: string, b: Blob) => void cache.set(k, b),
      keys: async () => [...cache.keys()],
      delete: async (k: string) => void cache.delete(k),
    },
    loadBlob: async (a: MediaAsset) => a.blob,
    makeURL: (b: Blob) => `blob:proxy-${(b as Blob & { tag?: string }).tag ?? 'x'}`,
    revokeURL: () => undefined,
    build: (blob: Blob, onProgress: (f: number) => void) =>
      new Promise<Blob>((resolve, reject) => {
        builds.push(String(blob.size));
        pendingBuild = { resolve, reject, progress: onProgress };
      }),
  } satisfies Partial<ProxyDeps>);
  const { project } = makeProject();
  S().loadProject({ ...project, assets: {} });
  useEditorStore.setState({ hydrated: true });
});

afterEach(() => {
  stop?.();
  stop = null;
  Object.assign(proxyDeps, original);
});

const proxyBlob = (tag: string) => Object.assign(new Blob(['p']), { tag });

describe('preview proxies', () => {
  it('builds a proxy for a new video in the background and switches the preview to it', async () => {
    stop = startProxies();
    S().addAsset(video('v1'));
    await flush();
    expect(builds).toHaveLength(1);
    pendingBuild!.progress(0.4);
    expect(useProxyStore.getState().building.v1).toBeCloseTo(0.4);
    expect(previewUrl(S().project.assets.v1!)).toBe('blob:v1'); // original until ready
    pendingBuild!.resolve(proxyBlob('v1'));
    await flush();
    const a = S().project.assets.v1!;
    expect(a.previewURL).toBe('blob:proxy-v1');
    expect(previewUrl(a)).toBe('blob:proxy-v1');
    expect(a.objectURL).toBe('blob:v1'); // export still reads the original
    expect(cache.size).toBe(1);
    expect(useProxyStore.getState().building).toEqual({});
  });

  it('reuses a cached proxy without rebuilding, and builds one at a time', async () => {
    cache.set('v1@v1', proxyBlob('cached'));
    stop = startProxies();
    S().addAsset(video('v1'));
    S().addAsset(video('v2'));
    S().addAsset(video('v3'));
    await flush();
    expect(S().project.assets.v1!.previewURL).toBe('blob:proxy-cached');
    expect(builds).toHaveLength(1); // v2 building, v3 queued
    expect(useProxyStore.getState().queued).toEqual(['v3']);
    pendingBuild!.resolve(proxyBlob('v2'));
    await flush();
    expect(builds).toHaveLength(2);
    pendingBuild!.resolve(proxyBlob('v3'));
    await flush();
    expect(S().project.assets.v3!.previewURL).toBe('blob:proxy-v3');
  });

  it('keeps the original when a proxy cannot be built', async () => {
    stop = startProxies();
    S().addAsset(video('v1'));
    await flush();
    pendingBuild!.reject(new Error('no encoder'));
    await flush();
    expect(S().project.assets.v1!.previewURL).toBeUndefined();
    expect(useProxyStore.getState().failed.v1).toBe('no encoder');
  });

  it('skips audio/images and waits for the project to be restored', async () => {
    useEditorStore.setState({ hydrated: false });
    stop = startProxies();
    S().addAsset(makeAsset('a1', 5, 'audio'));
    S().addAsset(video('v1'));
    await flush();
    expect(builds).toHaveLength(0);
    useEditorStore.setState({ hydrated: true });
    await flush();
    expect(builds).toHaveLength(1);
  });

  it('prunes cached proxies of assets that are gone', async () => {
    S().addAsset(video('v1'));
    cache.set('v1@v1', proxyBlob('a'));
    cache.set('gone@v1', proxyBlob('b'));
    await pruneProxies();
    expect([...cache.keys()]).toEqual(['v1@v1']);
  });

  it('never saves the proxy URL with the project', () => {
    S().addAsset(video('v1'));
    S().updateAsset('v1', { previewURL: 'blob:p' });
    expect(serializeProject(S().project).assets.v1).not.toHaveProperty('previewURL');
  });
});
