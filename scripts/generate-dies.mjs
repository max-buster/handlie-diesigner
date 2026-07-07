// Generate die-plate STLs from scripts/dies.config.json into ./output (gitignored).
// Run: npm run generate:dies
//
// The die-plate geometry here mirrors buildDieGeometry/geometryToStl in
// src/die-designer.jsx (chamfered outer rim + hole lead-in, sharp top land,
// rests on the bed at min Z = 0). Hole outlines are generated analytically so
// the script needs no browser/DOM and no extra dependencies.

import * as THREE from "three";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "output");

// ---- Physical calibration (matches the app) -------------------------------
const DISC_MM = 50.8;       // 2" plate
const DISC_THICK_MM = 5;
const DEFAULT_CHAMFER = 0.4;
const DEFAULT_TOP_CHAMFER = 0.8; // larger top rim so print flare stays inside the bore
const DEFAULT_HOLE_TOP_CHAMFER = 0.3; // slight deburr on the hole's top (exit) edge

// ---- Hole outline generators (mm, centred on origin, y-up) -----------------
function ovalPoints(W, H, n = 160) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([(W / 2) * Math.cos(t), (H / 2) * Math.sin(t)]);
  }
  return pts;
}

// Mirrors pebblePath() in the app: rounded top via two cubics, flat-ish bottom
// with corner fillets. Built in SVG (y-down) coords, then flipped to y-up.
function pebblePoints(W, H, perCubic = 64, perArc = 24) {
  const x0 = -W / 2, x1 = W / 2, yt = -H / 2, yb = H / 2;
  const br = Math.min(W * 0.18, H * 0.4);
  const cubic = (p0, p1, p2, p3, seg, includeEnd) => {
    const out = [];
    const last = includeEnd ? seg : seg - 1;
    for (let i = 0; i <= last; i++) {
      const t = i / seg, m = 1 - t;
      out.push([
        m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
        m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return out;
  };
  const arc = (cx, cy, a0, a1, seg, includeEnd) => {
    const out = [];
    const last = includeEnd ? seg : seg - 1;
    for (let i = 0; i <= last; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      out.push([cx + br * Math.cos(a), cy + br * Math.sin(a)]);
    }
    return out;
  };
  // The flat bottom edge is the implicit segment between the two fillet ends,
  // so no explicit point is added there (that would duplicate the BL start).
  const pts = [
    ...cubic([x0, yb - br], [x0, -H * 0.1], [-W * 0.32, yt], [0, yt], perCubic, false),
    ...cubic([0, yt], [W * 0.32, yt], [x1, -H * 0.1], [x1, yb - br], perCubic, false),
    ...arc(x1 - br, yb - br, 0, Math.PI / 2, perArc, true),                  // bottom-right fillet (incl. end)
    ...arc(x0 + br, yb - br, Math.PI / 2, Math.PI, perArc, false),           // bottom-left fillet (excl. end = start)
  ];
  return pts.map(([x, y]) => [x, -y]); // flip to y-up
}

// Circle: ellipse with both radii = width/2 (matches the app's circle case).
function circlePoints(W, n = 160) {
  return ovalPoints(W, W, n);
}

// Rounded rectangle / capsule (matches roundRectPath; capsule uses r = min/2).
// Side edges may collapse to a point (capsule) -> deduped downstream.
function roundRectPoints(W, H, r, perArc = 18) {
  r = Math.max(0, Math.min(r, Math.min(W, H) / 2));
  const ax = W / 2 - r, ay = H / 2 - r;
  const corners = [
    [ax, -ay, -Math.PI / 2, 0],            // bottom-right
    [ax, ay, 0, Math.PI / 2],              // top-right
    [-ax, ay, Math.PI / 2, Math.PI],       // top-left
    [-ax, -ay, Math.PI, 1.5 * Math.PI],    // bottom-left
  ];
  const pts = [];
  for (const [cx, cy, a0, a1] of corners)
    for (let i = 0; i <= perArc; i++) {
      const a = a0 + ((a1 - a0) * i) / perArc;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return pts;
}

// Bone (matches bonePath): two round lobes joined by a smooth waist. Built in
// SVG (y-down) coords using the same math, then flipped to y-up. waistHalf is
// the half-height of the skinniest section, in mm.
function bonePoints(W, H, waistHalf, perCubic = 48, perArc = 28) {
  const rl = Math.min(H / 2, W / 2.2);
  const Lx = -W / 2 + rl, Rx = W / 2 - rl;
  let jx = rl * Math.sin(0.6);
  jx = Math.min(jx, Math.max(0, (Rx - Lx) / 2 - 0.06 * rl));
  const jy = Math.sqrt(Math.max(0, rl * rl - jx * jx));
  const sinA = jx / rl, cosA = jy / rl;
  const TLx = Lx + jx, TRx = Rx - jx, Ty = -jy, By = jy;
  const half = Math.max(0.06 * rl, Math.min(waistHalf, 0.96 * jy));
  const hNeed = (jy - half) / Math.max(0.05, 0.75 * sinA);
  const hMax = Math.max(0, ((TRx - TLx) * 0.5 - 0.04 * rl) / Math.max(0.05, cosA));
  const h = Math.min(hNeed, hMax);
  const hx = h * cosA, hy = h * sinA;

  // Arc on a known lobe circle, SVG sweep-flag 1 (increasing angle). Start-incl,
  // end-excl so the following segment supplies the shared endpoint.
  const arcSeg = (cx, cy, p0, p1, seg) => {
    let a0 = Math.atan2(p0[1] - cy, p0[0] - cx), a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    while (a1 <= a0) a1 += Math.PI * 2;
    const out = [];
    for (let i = 0; i < seg; i++) { const a = a0 + ((a1 - a0) * i) / seg; out.push([cx + rl * Math.cos(a), cy + rl * Math.sin(a)]); }
    return out;
  };
  const cubicSeg = (p0, p1, p2, p3, seg) => {
    const out = [];
    for (let i = 0; i < seg; i++) {
      const t = i / seg, m = 1 - t;
      out.push([
        m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
        m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return out;
  };
  const L = [-W / 2, 0], R = [W / 2, 0], TL = [TLx, Ty], TR = [TRx, Ty], BL = [TLx, By], BR = [TRx, By];
  const pts = [
    ...arcSeg(Lx, 0, L, TL, perArc),                                       // up over left lobe
    ...cubicSeg(TL, [TLx + hx, Ty + hy], [TRx - hx, Ty + hy], TR, perCubic), // top waist
    ...arcSeg(Rx, 0, TR, R, perArc),                                       // over right lobe to rightmost
    ...arcSeg(Rx, 0, R, BR, perArc),                                       // down right lobe
    ...cubicSeg(BR, [TRx - hx, By - hy], [TLx + hx, By - hy], BL, perCubic), // bottom waist
    ...arcSeg(Lx, 0, BL, L, perArc),                                       // up left lobe back to start
  ];
  return pts.map(([x, y]) => [x, -y]); // flip to y-up
}

// Remove consecutive (and wrap-around) near-duplicate vertices.
function dedupe(pts, eps = 1e-4) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}

const SHAPES = {
  oval: (s) => ovalPoints(s.width, s.height),
  circle: (s) => circlePoints(s.width),
  capsule: (s) => roundRectPoints(s.width, s.height, Math.min(s.width, s.height) / 2),
  pebble: (s) => pebblePoints(s.width, s.height),
  bone: (s) => bonePoints(s.width, s.height, (s.waistHeight ?? s.height * 0.6) / 2),
};

// ---- Solid die plate from a hole outline ----------------------------------
function edgeNormal2(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  return [dy / L, -dx / L];
}
function offsetPolygon(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const n1 = edgeNormal2(prev, cur), n2 = edgeNormal2(cur, next);
    let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
    const L = Math.hypot(nx, ny) || 1;
    out.push([cur[0] + (nx / L) * d, cur[1] + (ny / L) * d]);
  }
  return out;
}
function buildDieGeometry(holePoints, chamfer = DEFAULT_CHAMFER, topChamfer = DEFAULT_TOP_CHAMFER, holeTopChamfer = DEFAULT_HOLE_TOP_CHAMFER) {
  const T = DISC_THICK_MM, R = DISC_MM / 2;
  const C = Math.min(chamfer, T / 2 - 0.1);
  const Ctop = Math.min(topChamfer, T / 2 - 0.1);
  const Chole = Math.min(holeTopChamfer, T / 2 - 0.1);
  const zb = -T / 2, zt = T / 2;
  const circle = (r, n = 160) => {
    const a = [];
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; a.push([Math.cos(t) * r, Math.sin(t) * r]); }
    return a;
  };
  const outerFull = circle(R), outerInset = circle(R - C), outerInsetTop = circle(R - Ctop);
  let hole = holePoints.slice();
  let area = 0;
  for (let i = 0; i < hole.length; i++) { const a = hole[i], b = hole[(i + 1) % hole.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) hole = hole.slice().reverse();
  const holeBig = offsetPolygon(hole, C);            // bottom entry lead-in
  const holeTop = offsetPolygon(hole, Chole);         // slight top exit deburr

  const pos = [], idx = [];
  const pushLoop = (pts, z) => { const s = pos.length / 3; for (const p of pts) pos.push(p[0], p[1], z); return s; };
  const strip = (lo, up, M, flip) => {
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M, A = lo + i, B = lo + j, U = up + i, D = up + j;
      if (flip) idx.push(A, D, B, A, U, D); else idx.push(A, B, D, A, D, U);
    }
  };
  const cap = (contour, holePts, z, faceUp) => {
    const holeCW = holePts.slice().reverse();
    const tris = THREE.ShapeUtils.triangulateShape(
      contour.map((p) => new THREE.Vector2(p[0], p[1])),
      [holeCW.map((p) => new THREE.Vector2(p[0], p[1]))]
    );
    const base = pushLoop(contour.concat(holeCW), z);
    for (const t of tris) {
      if (faceUp) idx.push(base + t[0], base + t[1], base + t[2]);
      else idx.push(base + t[0], base + t[2], base + t[1]);
    }
  };

  const NO = outerFull.length;
  const O0 = pushLoop(outerInset, zb), O1 = pushLoop(outerFull, zb + C);
  const O2 = pushLoop(outerFull, zt - Ctop), O3 = pushLoop(outerInsetTop, zt);
  strip(O0, O1, NO, false); strip(O1, O2, NO, false); strip(O2, O3, NO, false);

  const NH = hole.length;
  const H0 = pushLoop(holeBig, zb), H1 = pushLoop(hole, zb + C);
  const H2 = pushLoop(hole, zt - Chole), H3 = pushLoop(holeTop, zt);
  strip(H0, H1, NH, true); strip(H1, H2, NH, true); strip(H2, H3, NH, true);

  cap(outerInset, holeBig, zb, false);
  cap(outerInsetTop, holeTop, zt, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function geometryToStl(geo, name = "die") {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute("position");
  const lines = [`solid ${name}`];
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    lines.push(`facet normal ${nx} ${ny} ${nz}`, "outer loop",
      `vertex ${ax} ${ay} ${az}`, `vertex ${bx} ${by} ${bz}`, `vertex ${cx} ${cy} ${cz}`,
      "endloop", "endfacet");
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n");
}

// ---- Run -------------------------------------------------------------------
const config = JSON.parse(readFileSync(join(__dirname, "dies.config.json"), "utf8"));
const chamfer = config.chamfer_mm ?? DEFAULT_CHAMFER;

rmSync(OUT, { recursive: true, force: true });
let count = 0;
for (const set of config.sets) {
  const gen = SHAPES[set.shape];
  if (!gen) throw new Error(`Unknown shape "${set.shape}" in set "${set.name}"`);
  const dir = join(OUT, set.name);
  mkdirSync(dir, { recursive: true });
  for (const size of set.sizes) {
    const geo = buildDieGeometry(dedupe(gen(size)), chamfer);
    geo.translate(0, 0, DISC_THICK_MM / 2); // rest on the bed (min Z = 0), sharp land up
    const file = join(dir, `${set.name}-${size.label}-${size.width}x${size.height}mm.stl`);
    writeFileSync(file, geometryToStl(geo, `${set.name}-${size.label}`));
    geo.dispose();
    count++;
    console.log(`  ${set.shape.padEnd(7)} ${size.label.padEnd(7)} ${size.width}x${size.height}mm -> ${file.replace(ROOT + "/", "")}`);
  }
}
console.log(`\nGenerated ${count} STL${count === 1 ? "" : "s"} in ./output`);
