// One picture file, one copy on the graphics card (round 6, perf P). The roads and the bridges each made their own
// textures of the same six road pictures (asphalt and concrete: colour, normal and roughness), 13 uploads of 1024 px
// pictures where 6 do; here every texture of a file is a clone of the first, sharing its picture (three.js sends a
// shared picture once when the textures' settings match), so a clone may have its own repeat.
// On the low tier (quality.js) the normal and roughness pictures are left out (null): the road is drawn flat-shaded
// from its colour picture, a cheaper shader over the largest part of the screen.
import * as THREE from 'three';

const CACHE = new Map();
export function sharedTexture(url, { srgb = false, anisotropy = 8, optional = false } = {}) {
  const q = globalThis.__carQuality;
  if (optional && q && q.low) return null;
  if (q && q.low) anisotropy = Math.min(anisotropy, 4);
  else anisotropy = 8; // (one setting for all, or three.js uploads the picture once per setting)
  const key = url + '|' + (srgb ? 1 : 0);
  let e = CACHE.get(key);
  if (!e) {
    e = { first: null, clones: [], loaded: false };
    e.first = new THREE.TextureLoader().load(url, () => { e.loaded = true; for (const c of e.clones) c.needsUpdate = true; e.clones.length = 0; });
    e.first.wrapS = e.first.wrapT = THREE.RepeatWrapping; e.first.anisotropy = anisotropy;
    if (srgb) e.first.colorSpace = THREE.SRGBColorSpace;
    CACHE.set(key, e);
    return e.first;
  }
  const t = e.first.clone();
  if (e.loaded) t.needsUpdate = true; else e.clones.push(t);
  return t;
}
