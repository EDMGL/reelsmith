/**
 * Discovers every feature package and calls its `register()` export once.
 * Feature packages never need to edit this file: any `src/features/<name>/index.ts`
 * (and `src/engine/index.ts`) exporting `register(): void` is picked up.
 */
interface FeatureModule {
  register?: () => void;
}

const modules = import.meta.glob<FeatureModule>(['../engine/index.ts', '../features/*/index.ts'], { eager: true });

let done = false;

export function registerFeatures(): void {
  if (done) return;
  done = true;
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path]!;
    if (typeof mod.register !== 'function') continue;
    try {
      mod.register();
    } catch (e) {
      console.error(`[features] register() failed in ${path}`, e);
    }
  }
}

/** Paths of discovered feature modules (diagnostics/tests). */
export const featureModulePaths = Object.keys(modules).sort();
