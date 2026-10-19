// WGS84 and the game's local frame. The local frame is east-up-south at the drop point: +x east, +y up, +z south
// (so north is -z, as three.js cameras look down -z). One unit is one metre. A heading is degrees clockwise
// from north; the direction it points is (sin h, 0, -cos h).
import * as THREE from 'three';

const A = 6378137.0, F = 1 / 298.257223563, E2 = F * (2 - F), B = A * (1 - F), EP2 = (A * A - B * B) / (B * B);
const D2R = Math.PI / 180;

export function toECEF(lat, lon, h = 0, out = new THREE.Vector3()) {
  const la = lat * D2R, lo = lon * D2R, s = Math.sin(la), c = Math.cos(la);
  const N = A / Math.sqrt(1 - E2 * s * s);
  return out.set((N + h) * c * Math.cos(lo), (N + h) * c * Math.sin(lo), (N * (1 - E2) + h) * s);
}

export function fromECEF(v) {
  const x = v.x, y = v.y, z = v.z, p = Math.hypot(x, y), th = Math.atan2(z * A, p * B);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z + EP2 * B * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3);
  const s = Math.sin(lat), N = A / Math.sqrt(1 - E2 * s * s);
  return { lat: lat / D2R, lon: lon / D2R, h: p / Math.cos(lat) - N };
}

// The frame at the drop point. ecefToLocal takes ECEF to local, localToEcef the other way.
export const frame = {
  lat: 0, lon: 0, h: 0,
  ecefToLocal: new THREE.Matrix4(),
  localToEcef: new THREE.Matrix4(),
};

export function setOrigin(lat, lon, h = 0) {
  frame.lat = lat; frame.lon = lon; frame.h = h;
  const la = lat * D2R, lo = lon * D2R;
  const e = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
  const n = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  const u = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  const o = toECEF(lat, lon, h);
  // columns: local x = east, local y = up, local z = south
  const s = n.clone().negate();
  frame.localToEcef.makeBasis(e, u, s).setPosition(o);
  frame.ecefToLocal.copy(frame.localToEcef).invert();
  return frame;
}

const _v = new THREE.Vector3();
export function toLocal(lat, lon, h = 0, out = new THREE.Vector3()) {
  return toECEF(lat, lon, h, out).applyMatrix4(frame.ecefToLocal);
}
export function toLatLon(v) {
  return fromECEF(_v.copy(v).applyMatrix4(frame.localToEcef));
}

// Fast flat projection for big batches near the origin (OSM nodes): good to a few millimetres within 3 km,
// apart from the earth's curvature, which drops the ground by d^2 / 2R (8 cm at 1 km). Heights come from the
// ground sampler anyway, so callers use x and z from here and y from the world.
export function project(lat, lon) {
  const la = frame.lat * D2R, s = Math.sin(la);
  const N = A / Math.sqrt(1 - E2 * s * s), M = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5);
  return [(lon - frame.lon) * D2R * N * Math.cos(la), -(lat - frame.lat) * D2R * M];
}
export function unproject(x, z) {
  const la = frame.lat * D2R, s = Math.sin(la);
  const N = A / Math.sqrt(1 - E2 * s * s), M = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5);
  return { lat: frame.lat - z / M / D2R, lon: frame.lon + x / (N * Math.cos(la)) / D2R };
}

// Heading (degrees clockwise from north) <-> direction in the local frame.
export const headingDir = (h, out = new THREE.Vector3()) => out.set(Math.sin(h * D2R), 0, -Math.cos(h * D2R));
export const dirHeading = (x, z) => (Math.atan2(x, -z) / D2R + 360) % 360;

// Web Mercator tile helpers (imagery and elevation tiles).
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z, la = lat * D2R;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n];
}
export function tileToLonLat(x, y, z) {
  const n = 2 ** z, lon = x / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / D2R;
  return [lon, lat];
}
