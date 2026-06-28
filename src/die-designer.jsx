import React, { useState, useMemo, useRef, useEffect } from "react";
import { Download } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ---- Physical calibration -------------------------------------------------
const VB = 440;
const CX = VB / 2;
const CY = VB / 2;
const DISC_R = 190;
const DISC_MM = 50.8;
const DISC_THICK_MM = 3;
const UPM = (DISC_R * 2) / DISC_MM;
const u = (m) => m * UPM;

const W_MIN = 6, W_MAX = 38;
const H_MIN = 4, H_MAX = 22;

const fmt = (n) => Math.round(n * 100) / 100;

function ellipsePath(cx, cy, rx, ry) {
  return `M ${fmt(cx - rx)} ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`;
}
function roundRectPath(cx, cy, W, H, r) {
  r = Math.max(0, Math.min(r, Math.min(W, H) / 2));
  const x = cx - W / 2, y = cy - H / 2;
  return [
    `M ${fmt(x + r)} ${fmt(y)}`, `H ${fmt(x + W - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + W)} ${fmt(y + r)}`, `V ${fmt(y + H - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + W - r)} ${fmt(y + H)}`, `H ${fmt(x + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y + H - r)}`, `V ${fmt(y + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(y)}`, "Z",
  ].join(" ");
}
function dShapePath(cx, cy, W, H) {
  const tr = Math.min(W / 2, H / 2);              // top dome radius
  const br = Math.min(H * 0.35, W * 0.18, tr);    // bottom-corner fillet
  const x = cx - W / 2, y = cy - H / 2;
  return [
    `M ${fmt(x)} ${fmt(y + H - br)}`, `V ${fmt(y + tr)}`,
    `A ${fmt(tr)} ${fmt(tr)} 0 0 1 ${fmt(x + tr)} ${fmt(y)}`, `H ${fmt(x + W - tr)}`,
    `A ${fmt(tr)} ${fmt(tr)} 0 0 1 ${fmt(x + W)} ${fmt(y + tr)}`, `V ${fmt(y + H - br)}`,
    `A ${fmt(br)} ${fmt(br)} 0 0 1 ${fmt(x + W - br)} ${fmt(y + H)}`, `H ${fmt(x + br)}`,
    `A ${fmt(br)} ${fmt(br)} 0 0 1 ${fmt(x)} ${fmt(y + H - br)}`, "Z",
  ].join(" ");
}
function pebblePath(cx, cy, W, H) {
  const x0 = cx - W / 2, x1 = cx + W / 2, yt = cy - H / 2, yb = cy + H / 2;
  const br = Math.min(W * 0.18, H * 0.4);         // bottom-corner fillet
  return [
    `M ${fmt(x0)} ${fmt(yb - br)}`,
    `C ${fmt(x0)} ${fmt(cy - H * 0.1)} ${fmt(cx - W * 0.32)} ${fmt(yt)} ${fmt(cx)} ${fmt(yt)}`,
    `C ${fmt(cx + W * 0.32)} ${fmt(yt)} ${fmt(x1)} ${fmt(cy - H * 0.1)} ${fmt(x1)} ${fmt(yb - br)}`,
    `A ${fmt(br)} ${fmt(br)} 0 0 1 ${fmt(x1 - br)} ${fmt(yb)}`, `H ${fmt(x0 + br)}`,
    `A ${fmt(br)} ${fmt(br)} 0 0 1 ${fmt(x0)} ${fmt(yb - br)}`, "Z",
  ].join(" ");
}
function thumbGroovePath(cx, cy, W, H, r, depth, gwDesired) {
  r = Math.max(0, Math.min(r, H / 2, 0.28 * W));
  depth = Math.min(depth, H * 0.45);
  const x0 = cx - W / 2, x1 = cx + W / 2, yt = cy - H / 2, yb = cy + H / 2;
  const gw = Math.max(W * 0.1, Math.min(gwDesired, (W - 2 * r) * 0.95));
  const gx0 = cx - gw / 2, gx1 = cx + gw / 2, by = yt + depth;
  const k = gw * 0.28, k2 = gw * 0.16;            // tangent handles: flat at shoulders + groove floor
  return [
    `M ${fmt(x0 + r)} ${fmt(yt)}`, `L ${fmt(gx0)} ${fmt(yt)}`,
    `C ${fmt(gx0 + k)} ${fmt(yt)} ${fmt(cx - k2)} ${fmt(by)} ${fmt(cx)} ${fmt(by)}`,
    `C ${fmt(cx + k2)} ${fmt(by)} ${fmt(gx1 - k)} ${fmt(yt)} ${fmt(gx1)} ${fmt(yt)}`,
    `L ${fmt(x1 - r)} ${fmt(yt)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x1)} ${fmt(yt + r)}`, `V ${fmt(yb - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x1 - r)} ${fmt(yb)}`, `H ${fmt(x0 + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x0)} ${fmt(yb - r)}`, `V ${fmt(yt + r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x0 + r)} ${fmt(yt)}`, "Z",
  ].join(" ");
}
// waistHalf = half-height (px) of the skinniest middle section.
function bonePath(cx, cy, W, H, waistHalf) {
  const rl = Math.min(H / 2, W / 2.2);
  const Lx = cx - W / 2 + rl, Rx = cx + W / 2 - rl; // lobe centre x's
  // Junction where the waist leaves each lobe tangentially. Offset jx is capped
  // so the two junctions keep a gap (lobes never overlap); jy stays on the
  // circle so the cubic still leaves the lobe smoothly.
  let jx = rl * Math.sin(0.6);
  jx = Math.min(jx, Math.max(0, (Rx - Lx) / 2 - 0.06 * rl));
  const jy = Math.sqrt(Math.max(0, rl * rl - jx * jx));
  const sinA = jx / rl, cosA = jy / rl;
  const TLx = Lx + jx, TRx = Rx - jx, Ty = cy - jy, By = cy + jy;
  // Skinniest half-height: positive and strictly less than the lobe, so the
  // top edge (cy - half) and bottom edge (cy + half) can never cross/invert.
  const half = Math.max(0.06 * rl, Math.min(waistHalf, 0.96 * jy));
  // Handle length that lands the cubic's narrowest point at cy +/- half,
  // capped so the control points can't cross (which would self-intersect).
  const hNeed = (jy - half) / Math.max(0.05, 0.75 * sinA);
  const hMax = Math.max(0, ((TRx - TLx) * 0.5 - 0.04 * rl) / Math.max(0.05, cosA));
  const h = Math.min(hNeed, hMax);
  const hx = h * cosA, hy = h * sinA;              // tangent components (matches lobe tangent)
  return [
    `M ${fmt(cx - W / 2)} ${fmt(cy)}`,
    `A ${fmt(rl)} ${fmt(rl)} 0 0 1 ${fmt(TLx)} ${fmt(Ty)}`,
    `C ${fmt(TLx + hx)} ${fmt(Ty + hy)} ${fmt(TRx - hx)} ${fmt(Ty + hy)} ${fmt(TRx)} ${fmt(Ty)}`,
    `A ${fmt(rl)} ${fmt(rl)} 0 0 1 ${fmt(cx + W / 2)} ${fmt(cy)}`,
    `A ${fmt(rl)} ${fmt(rl)} 0 0 1 ${fmt(TRx)} ${fmt(By)}`,
    `C ${fmt(TRx - hx)} ${fmt(By - hy)} ${fmt(TLx + hx)} ${fmt(By - hy)} ${fmt(TLx)} ${fmt(By)}`,
    `A ${fmt(rl)} ${fmt(rl)} 0 0 1 ${fmt(cx - W / 2)} ${fmt(cy)}`, "Z",
  ].join(" ");
}

function previewD(id) {
  const cx = 23, cy = 15;
  switch (id) {
    case "oval": return ellipsePath(cx, cy, 15, 8);
    case "circle": return ellipsePath(cx, cy, 9, 9);
    case "rrect": return roundRectPath(cx, cy, 30, 18, 5);
    case "capsule": return roundRectPath(cx, cy, 32, 15, 7.5);
    case "dshape": return dShapePath(cx, cy, 28, 18);
    case "pebble": return pebblePath(cx, cy, 30, 17);
    case "thumbgroove": return thumbGroovePath(cx, cy, 34, 15, 4, 5, 18);
    case "bone": return bonePath(cx, cy, 36, 15, 3.5);
    default: return "";
  }
}

// ---- 3D handle sweep ------------------------------------------------------
// Sweep a 2D profile (mm, centred at origin) along a C-shaped handle curve.
// Profile width -> sideways (Z, strap width); profile height -> bend plane (thickness).
function buildHandleGeometry(profilePts) {
  // Centerline sampled from a smooth superellipse so the swept curve has no
  // curvature jumps: roots tuck in at ROOT_X, the back bows out to REACH, and
  // the FLAT exponent keeps a flat-ish D back with naturally rounded shoulders.
  const ROOT_X = 37, REACH = 73, HALF_H = 35, FLAT = 0.7, SEG = 24;
  const cps = [];
  for (let i = 0; i <= SEG; i++) {
    const th = (Math.PI / 2) * (1 - (2 * i) / SEG); // +pi/2 (top root) -> -pi/2 (bottom root)
    const x = ROOT_X + (REACH - ROOT_X) * Math.pow(Math.cos(th), FLAT);
    const y = HALF_H * Math.sin(th);
    cps.push(new THREE.Vector3(x, y, 0));
  }
  const curve = new THREE.CatmullRomCurve3(cps, false, "centripetal");
  const STEPS = 110;
  const M = profilePts.length;
  const B = new THREE.Vector3(0, 0, 1); // out-of-plane = strap width
  const rings = [];
  const tmpT = new THREE.Vector3();
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    const P = curve.getPoint(t);
    curve.getTangent(t, tmpT).normalize();
    const Nn = new THREE.Vector3().crossVectors(B, tmpT).normalize(); // radial: +height = outer face of the loop
    const ring = [];
    for (let m = 0; m < M; m++) {
      const px = profilePts[m][0], py = profilePts[m][1];
      ring.push(new THREE.Vector3().copy(P).addScaledVector(B, px).addScaledVector(Nn, py));
    }
    rings.push(ring);
  }
  const pos = [], idx = [], stride = M;
  for (let s = 0; s <= STEPS; s++) for (let m = 0; m < M; m++) { const v = rings[s][m]; pos.push(v.x, v.y, v.z); }
  for (let s = 0; s < STEPS; s++) {
    for (let m = 0; m < M; m++) {
      const a = s * stride + m, b = s * stride + ((m + 1) % M);
      const c = (s + 1) * stride + m, d = (s + 1) * stride + ((m + 1) % M);
      idx.push(a, b, d, a, d, c);
    }
  }
  const cap = (ri, flip) => {
    const base = ri * stride;
    let cx = 0, cy = 0, cz = 0;
    for (let m = 0; m < M; m++) { const v = rings[ri][m]; cx += v.x; cy += v.y; cz += v.z; }
    cx /= M; cy /= M; cz /= M;
    const ci = pos.length / 3; pos.push(cx, cy, cz);
    for (let m = 0; m < M; m++) {
      const a = base + m, b = base + ((m + 1) % M);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  cap(0, false); cap(STEPS, true);
  // Guarantee outward-facing normals regardless of source winding.
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
         - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
         + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// 1-D Catmull-Rom through [y, r] controls -> Vector2(r, y) samples for a lathe.
function smoothProfile(controls, perSeg) {
  const n = controls.length, out = [];
  const P = (i) => controls[Math.max(0, Math.min(n - 1, i))];
  const cr = (a, b, c, d, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      out.push(new THREE.Vector2(cr(p0[1], p1[1], p2[1], p3[1], t), cr(p0[0], p1[0], p2[0], p3[0], t)));
    }
  }
  out.push(new THREE.Vector2(controls[n - 1][1], controls[n - 1][0]));
  return out;
}

// Hand-thrown mug silhouette revolved around Y: chamfered foot, soft belly,
// rounded lip, hollow interior. Profile traced base -> up -> over -> inside.
function buildMugGeometry() {
  const topY = 48, Rto = 40, wall = 6, Rti = Rto - wall;
  const rr = wall / 2, rimCy = topY - rr, rimCx = (Rto + Rti) / 2, floorY = -33;
  const outer = smoothProfile([[-44, 38], [-30, 42], [-12, 43], [10, 42.5], [30, 41], [rimCy, Rto]], 6);
  const inner = smoothProfile([[floorY, 31], [-18, 34], [12, 35.5], [34, 35], [rimCy, Rti]], 6);
  const pts = [];
  pts.push(new THREE.Vector2(0, -48));
  pts.push(new THREE.Vector2(34, -48));   // foot contact (chamfer rises to wall)
  for (const v of outer) pts.push(v);     // bellied outer wall up to the rim
  for (let i = 0; i <= 12; i++) {         // rounded lip
    const th = (Math.PI * i) / 12;
    pts.push(new THREE.Vector2(rimCx + rr * Math.cos(th), rimCy + rr * Math.sin(th)));
  }
  for (let i = inner.length - 1; i >= 0; i--) pts.push(inner[i]); // inner wall down
  pts.push(new THREE.Vector2(0, floorY)); // inner floor to axis
  return new THREE.LatheGeometry(pts, 96);
}

function MugPreview({ holeD }) {
  const mountRef = useRef(null);
  const pathRef = useRef(null);
  const ctx = useRef({});
  const [rot, setRot] = useState(35);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const mount = mountRef.current;
    let raf;
    try {
      const W = mount.clientWidth || 320, H = mount.clientHeight || 300;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(33, W / H, 1, 3000);
      camera.position.set(118, 52, 246);
      const target = new THREE.Vector3(8, 2, 0);
      const baseOffset = camera.position.clone().sub(target); // for zoom (camera dolly)
      camera.lookAt(target);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W, H);
      mount.appendChild(renderer.domElement);
      renderer.domElement.style.touchAction = "none";

      scene.add(new THREE.HemisphereLight(0xffe9cf, 0x140d06, 0.5));
      const key = new THREE.DirectionalLight(0xfff1df, 0.78); key.position.set(70, 150, 130); scene.add(key);
      const fill = new THREE.DirectionalLight(0xffd6a0, 0.18); fill.position.set(-140, 30, 70); scene.add(fill);
      const rim = new THREE.DirectionalLight(0xffe6c4, 0.3); rim.position.set(-60, 120, -150); scene.add(rim);

      // soft contact shadow (canvas radial blob, no shadow-map cost)
      const sc = document.createElement("canvas"); sc.width = sc.height = 128;
      const g2 = sc.getContext("2d");
      const grd = g2.createRadialGradient(64, 64, 6, 64, 64, 62);
      grd.addColorStop(0, "rgba(0,0,0,0.4)"); grd.addColorStop(1, "rgba(0,0,0,0)");
      g2.fillStyle = grd; g2.fillRect(0, 0, 128, 128);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(180, 180),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -47.6; scene.add(shadow);

      const group = new THREE.Group(); scene.add(group);
      const clay = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
      const mug = new THREE.Mesh(buildMugGeometry(), clay);
      group.add(mug);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x6b4e30, roughness: 1, side: THREE.DoubleSide }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -32.8; group.add(floor);
      const handle = new THREE.Mesh(new THREE.BufferGeometry(), clay);
      group.add(handle);

      const c = ctx.current;
      Object.assign(c, { scene, camera, renderer, group, handle, mount, target, baseOffset });

      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth || 320, h = mount.clientHeight || 300;
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      });
      ro.observe(mount);

      const loop = () => { renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
      loop();

      c.cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
    } catch (err) { console.error("3D init failed", err); }
    return () => { ctx.current.cleanup && ctx.current.cleanup(); };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c || !c.handle || !pathRef.current) return;
    try {
      const el = pathRef.current;
      el.setAttribute("d", holeD);
      const total = el.getTotalLength();
      if (!total) return;
      const N = 130, pts = [];
      for (let i = 0; i < N; i++) {
        const p = el.getPointAtLength((total * i) / N);
        pts.push([(p.x - CX) / UPM, -(p.y - CY) / UPM]);
      }
      let area = 0;
      for (let i = 0; i < N; i++) { const a = pts[i], b = pts[(i + 1) % N]; area += a[0] * b[1] - b[0] * a[1]; }
      if (area < 0) pts.reverse();
      const geo = buildHandleGeometry(pts);
      c.handle.geometry.dispose();
      c.handle.geometry = geo;
    } catch (err) { console.error("handle build failed", err); }
  }, [holeD]);

  useEffect(() => {
    const c = ctx.current;
    if (c && c.group) c.group.rotation.y = (rot * Math.PI) / 180;
  }, [rot]);

  useEffect(() => {
    const c = ctx.current;
    if (!c || !c.camera || !c.baseOffset) return;
    c.camera.position.copy(c.target).addScaledVector(c.baseOffset, 1 / zoom);
    c.camera.lookAt(c.target);
  }, [zoom]);

  const ZMIN = 0.6, ZMAX = 2.5, ZSTEP = 0.2;
  const clampZoom = (z) => Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 100) / 100));

  return (
    <>
      <div className="mug3d" ref={mountRef}>
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><path ref={pathRef} /></svg>
        <div className="zoomctl">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z - ZSTEP))} disabled={zoom <= ZMIN}>&minus;</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z + ZSTEP))} disabled={zoom >= ZMAX}>+</button>
        </div>
      </div>
      <label className="sl mug-rot">
        <div className="sl-top"><span>Rotate</span><b>{rot}&deg;</b></div>
        <input type="range" min={-180} max={180} step={1} value={rot} onChange={(e) => setRot(parseInt(e.target.value, 10))} />
      </label>
    </>
  );
}

// Sample an SVG path "d" into [x, y] points in millimetres (y up, centred on
// the disc), by measuring a temporarily-mounted off-screen path element.
function samplePathMM(d, n) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.style.position = "absolute"; svg.style.left = "-9999px";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path); document.body.appendChild(svg);
  const total = path.getTotalLength();
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p = path.getPointAtLength((total * i) / n);
    pts.push([(p.x - CX) / UPM, (CY - p.y) / UPM]);
  }
  document.body.removeChild(svg);
  return pts;
}

// Serialise a BufferGeometry (millimetres) to ASCII STL.
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

// ---- Minimal ZIP (store / no compression) ---------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function concatBytes(arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
// files: [{ name, data: Uint8Array }] -> Uint8Array of a valid .zip
function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), name, f.data,
    ]);
    chunks.push(local);
    central.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), name,
    ]));
    offset += local.length;
  }
  const cd = concatBytes(central);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return concatBytes([...chunks, cd, eocd]);
}
function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(",")[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Rasterise the 2D die view (grey disc with the profile cut out) to PNG bytes,
// on the dark bench colour so it matches the on-screen canvas for comparison.
function rasterizeDie(holeD, size = 800) {
  return new Promise((resolve, reject) => {
    const disc = ellipsePath(CX, CY, DISC_R, DISC_R);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VB} ${VB}"><path fill-rule="evenodd" d="${disc} ${holeD}" fill="#9a9a9a"/></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = size; c.height = size;
      const g = c.getContext("2d");
      g.fillStyle = "#16140f"; g.fillRect(0, 0, size, size);
      g.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(dataUrlToBytes(c.toDataURL("image/png")));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Solid die plate (mm): a disc the thickness of the plate with the handle
// profile cut clean through it. Centred on the origin in all three axes.
function buildDieGeometry(holeD) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, DISC_MM / 2, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.setFromPoints(samplePathMM(holeD, 220).map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DISC_THICK_MM, bevelEnabled: false, curveSegments: 64 });
  geo.translate(0, 0, -DISC_THICK_MM / 2);
  geo.computeVertexNormals();
  return geo;
}

// Build the order bundle (.zip): STL + a PNG of the 2D die view + params.json.
async function buildOrderBundle(geo, holeD, params) {
  const enc = new TextEncoder();
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const tag = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;

  const meta = {
    format: "handle-diesigner/v1",
    exportedAt: stamp.toISOString(),
    shape: params.shape,
    displayUnits: params.unit,
    plate: { diameter_mm: DISC_MM, thickness_mm: DISC_THICK_MM },
    profile_mm: {
      width: params.sw, height: params.sh, cornerRadius: params.sr,
      grooveDepth: params.gd, grooveWidth: params.grooveW, waistHeight: params.waistH,
    },
  };

  const png = await rasterizeDie(holeD);

  const zip = zipStore([
    { name: "die-spec/die-plate.stl", data: enc.encode(geometryToStl(geo, "die-plate")) },
    { name: "die-spec/die-view.png", data: png },
    { name: "die-spec/params.json", data: enc.encode(JSON.stringify(meta, null, 2)) },
  ]);

  const blob = new Blob([zip], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `die-order-${tag}.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Full-screen modal: interactive 3D preview of the die plate, with the button
// that downloads the order bundle.
function StlPreviewModal({ holeD, params, onClose }) {
  const mountRef = useRef(null);
  const three = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    let raf;
    const W = mount.clientWidth || 600, H = mount.clientHeight || 420;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 1000);
    camera.position.set(22, -28, 80);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x35302a, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(40, -40, 90); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.35); rim.position.set(-60, 40, -50); scene.add(rim);

    const geo = buildDieGeometry(holeD);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.82, metalness: 0.04, side: THREE.DoubleSide }));
    scene.add(mesh);
    three.current = { geo, renderer, scene, camera };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.1;
    controls.minDistance = 35; controls.maxDistance = 200;
    controls.target.set(0, 0, 0); controls.update();

    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || 600, h = mount.clientHeight || 420;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      window.removeEventListener("keydown", onKey);
      renderer.dispose(); geo.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      three.current = {};
    };
  }, [holeD, onClose]);

  const download = () => {
    const t = three.current;
    if (t.geo) buildOrderBundle(t.geo, holeD, params);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Preview die plate</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-3d" ref={mountRef} />
        <div className="modal-hint">Drag to rotate · scroll to zoom · the bundle includes a 2D die image for comparison</div>
        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={download}>
            <Download size={15} /> Download order pack
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DieDesigner() {
  const [shape, setShape] = useState("oval");
  const [sw, setSw] = useState(22);
  const [sh, setSh] = useState(12);
  const [sr, setSr] = useState(4);
  const [gd, setGd] = useState(4);
  const [grooveW, setGrooveW] = useState(11);
  const [waistH, setWaistH] = useState(6);
  const [unit, setUnit] = useState("mm");
  const holeD = useMemo(() => {
    const W = u(sw), H = u(sh);
    switch (shape) {
      case "oval": return ellipsePath(CX, CY, W / 2, H / 2);
      case "circle": return ellipsePath(CX, CY, W / 2, W / 2);
      case "rrect": return roundRectPath(CX, CY, W, H, u(sr));
      case "capsule": return roundRectPath(CX, CY, W, H, Math.min(W, H) / 2);
      case "dshape": return dShapePath(CX, CY, W, H);
      case "pebble": return pebblePath(CX, CY, W, H);
      case "thumbgroove": return thumbGroovePath(CX, CY, W, H, Math.min(H / 2, 0.28 * W), u(gd), u(grooveW));
      case "bone": return bonePath(CX, CY, W, H, u(waistH) / 2);
      default: return "";
    }
  }, [shape, sw, sh, sr, gd, grooveW, waistH]);

  const [previewOpen, setPreviewOpen] = useState(false);

  const shapes = [
    ["oval", "Oval"], ["circle", "Circle"],
    ["rrect", "Rounded"], ["capsule", "Capsule"],
    ["dshape", "D-strap"], ["pebble", "Pebble"],
    ["thumbgroove", "Thumb groove"], ["bone", "Bone"],
  ];

  return (
    <div className="root">
      <style>{CSS}</style>

      <header className="hd">
        <h1>Handle Diesigner</h1>
        <div className="eyebrow">Scott Creek Super Duper Clay Gun · 2&quot; wide · .25&quot; tall</div>
      </header>

      <div className="stage">
        <div className="bench">
          <svg viewBox={`0 0 ${VB} ${VB}`} className="canvas">
            <path fillRule="evenodd" d={`${ellipsePath(CX, CY, DISC_R, DISC_R)} ${holeD}`} fill="#9a9a9a" />
          </svg>
        </div>

        <div className="rightcol">
          <div className="mugcard">
            <div className="mugcard-label">On a mug</div>
            <MugPreview holeD={holeD} />
          </div>

          <aside className="panel">
            <div className="shape-row">
              {shapes.map(([id, label]) => (
                <button key={id} className={`shape ${shape === id ? "on" : ""}`} onClick={() => setShape(id)}>
                  <svg className="gly" viewBox="0 0 46 30"><path d={previewD(id)} fill="#cdac80" /></svg>
                  {label}
                </button>
              ))}
            </div>
            <div className="unit-row">
              <span>Units</span>
              <div className="unit-toggle">
                {["mm", "in"].map((un) => (
                  <button key={un} className={unit === un ? "on" : ""} onClick={() => setUnit(un)}>{un}</button>
                ))}
              </div>
            </div>
            <Slider label={shape === "circle" ? "Diameter" : "Width"} v={sw} set={setSw} min={W_MIN} max={W_MAX} unit={unit} />
            {shape !== "circle" && <Slider label="Height" v={sh} set={setSh} min={H_MIN} max={H_MAX} unit={unit} />}
            {shape === "rrect" && <Slider label="Corner radius" v={sr} set={setSr} min={0} max={Math.min(sw, sh) / 2} unit={unit} />}
            {shape === "thumbgroove" && <Slider label="Groove depth" v={gd} set={setGd} min={1} max={Math.max(2, sh * 0.45)} unit={unit} />}
            {shape === "thumbgroove" && <Slider label="Groove width" v={grooveW} set={setGrooveW} min={4} max={Math.max(6, sw * 0.95)} unit={unit} />}
            {shape === "bone" && <Slider label="Waist height" v={waistH} set={setWaistH} min={1} max={Math.max(2, sh * 0.9)} unit={unit} />}
            <div className="readout">
              <span>Handle profile</span>
              <b>{shape === "circle" ? `${fmtLen(sw, unit)} \u2300` : `${fmtLen(sw, unit)} \u00d7 ${fmtLen(sh, unit)}`}</b>
            </div>
            <button className="primary" onClick={() => setPreviewOpen(true)}>
              <Download size={15} /> Preview &amp; export
            </button>
          </aside>
        </div>
      </div>

      {previewOpen && (
        <StlPreviewModal
          holeD={holeD}
          params={{ shape, sw, sh, sr, gd, grooveW, waistH, unit }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

// Format a length given in mm in the chosen unit (mm or decimal inches).
function fmtLen(mm, unit) {
  return unit === "in" ? `${(mm / 25.4).toFixed(2)}″` : `${mm.toFixed(1)} mm`;
}

function Slider({ label, v, set, min, max, step = 0.5, unit = "mm" }) {
  return (
    <label className="sl">
      <div className="sl-top"><span>{label}</span><b>{fmtLen(v, unit)}</b></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(parseFloat(e.target.value))} />
    </label>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
.root{--bench:#16140f;--p:#211d16;--p2:#2b261d;--line:#3a342a;--text:#ece2d0;--dim:#a79c87;--accent:#e08a3c;--accent2:#7fa8ad;
  font-family:'Space Grotesk',system-ui,sans-serif;background:var(--bench);color:var(--text);min-height:100%;padding:20px;box-sizing:border-box;}
.root *{box-sizing:border-box;}
.hd{margin-bottom:16px;text-align:center;}
.eyebrow{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);opacity:.85;}
.hd h1{font-size:26px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em;}
.stage{display:grid;grid-template-columns:1fr 440px;gap:18px;align-items:start;}
.bench{background:radial-gradient(120% 120% at 50% 30%,#221d15,#100e0a);border:1px solid var(--line);border-radius:16px;padding:18px;}
.canvas{width:min(640px,100%);aspect-ratio:1;display:block;margin:0 auto;}
.rightcol{display:flex;flex-direction:column;gap:18px;}
.mugcard{position:relative;background:radial-gradient(120% 120% at 50% 25%,#241e15,#0e0c08);border:1px solid var(--line);border-radius:16px;padding:12px;}
.mugcard-label{font-family:'Space Mono',monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:2px 2px 8px;}
.mug3d{position:relative;width:100%;height:300px;border-radius:10px;overflow:hidden;}
.mug-rot{margin-top:12px;}
.zoomctl{position:absolute;right:8px;bottom:8px;display:flex;gap:6px;}
.zoomctl button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;
  background:rgba(33,29,22,.82);color:var(--text);border:1px solid var(--line);border-radius:7px;cursor:pointer;font-family:inherit;transition:.15s;}
.zoomctl button:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
.zoomctl button:disabled{opacity:.35;cursor:default;}
.panel{background:var(--p);border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px;}
.shape-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.shape{display:flex;align-items:center;gap:8px;background:var(--p2);border:1px solid var(--line);color:var(--dim);
  padding:9px 10px;border-radius:9px;font-size:12.5px;cursor:pointer;font-family:inherit;transition:.15s;}
.shape:hover{color:var(--text);}
.shape.on{border-color:var(--accent);color:var(--text);background:rgba(224,138,60,.1);}
.gly{width:26px;height:17px;flex:none;}
.unit-row{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--dim);}
.unit-toggle{display:inline-flex;background:var(--p2);border:1px solid var(--line);border-radius:8px;padding:2px;gap:2px;}
.unit-toggle button{border:none;background:none;color:var(--dim);font-family:'Space Mono',monospace;font-size:12px;
  padding:4px 12px;border-radius:6px;cursor:pointer;transition:.15s;}
.unit-toggle button.on{background:var(--accent);color:#1a1206;}
.sl{display:flex;flex-direction:column;gap:7px;}
.sl-top{display:flex;justify-content:space-between;font-size:12.5px;color:var(--dim);}
.sl-top b{color:var(--text);font-family:'Space Mono',monospace;font-weight:700;}
.sl input{-webkit-appearance:none;appearance:none;height:4px;border-radius:3px;background:var(--line);outline:none;}
.sl input::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid var(--bench);}
.sl input::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid var(--bench);}
.readout{background:var(--bench);border:1px solid var(--line);border-radius:11px;padding:11px 13px;display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--dim);}
.readout b{color:var(--text);font-family:'Space Mono',monospace;font-weight:700;}
.primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--accent);color:#1a1206;border:none;
  padding:11px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s;}
.primary:hover{background:#ec9a4f;}
.ghost{display:inline-flex;align-items:center;justify-content:center;background:var(--p2);color:var(--text);border:1px solid var(--line);
  padding:11px 16px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s;}
.ghost:hover{border-color:var(--dim);}
.modal-backdrop{position:fixed;inset:0;background:rgba(8,7,5,.72);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px;z-index:50;}
.modal{width:min(720px,100%);background:var(--p);border:1px solid var(--line);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5);}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
.modal-x{background:none;border:none;color:var(--dim);font-size:22px;line-height:1;cursor:pointer;padding:0 4px;transition:.15s;}
.modal-x:hover{color:var(--text);}
.modal-3d{width:100%;height:min(60vh,440px);background:radial-gradient(120% 120% at 50% 30%,#221d15,#100e0a);}
.modal-hint{padding:8px 16px 0;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);opacity:.6;text-align:center;}
.modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 16px;}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent2);outline-offset:2px;}
@media (max-width:900px){.stage{grid-template-columns:1fr;}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;}}
`;
