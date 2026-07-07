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
const DISC_THICK_MM = 5;
const CHAMFER_MM = 0.4;
const TOP_CHAMFER_MM = 0.8; // larger on the top rim so print flare stays inside the bore
const HOLE_TOP_CHAMFER_MM = 0.3; // slight deburr on the hole's top (exit) edge
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
  const rotRef = useRef(35);
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

      scene.add(new THREE.HemisphereLight(0xfff6e9, 0x5a4a38, 0.55));
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
      const clay = new THREE.MeshStandardMaterial({ color: 0xc47c55, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
      const mug = new THREE.Mesh(buildMugGeometry(), clay);
      group.add(mug);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x6b4e30, roughness: 1, side: THREE.DoubleSide }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -32.8; group.add(floor);
      const handle = new THREE.Mesh(new THREE.BufferGeometry(), clay);
      group.add(handle);

      const c = ctx.current;
      Object.assign(c, { scene, camera, renderer, group, handle, mount, target, baseOffset });

      // Drag-to-rotate: a horizontal sweep spins the mug, kept in sync with the slider.
      let drag = null;
      const dom = renderer.domElement;
      const onDown = (e) => {
        drag = { x: e.clientX, rot: rotRef.current };
        if (dom.setPointerCapture) dom.setPointerCapture(e.pointerId);
      };
      const onMove = (e) => {
        if (!drag) return;
        let nr = Math.round(drag.rot + (e.clientX - drag.x) * 0.6);
        nr = Math.max(-180, Math.min(180, nr));
        group.rotation.y = (nr * Math.PI) / 180;
        setRot(nr);
      };
      const onUp = (e) => {
        if (drag && dom.releasePointerCapture && e.pointerId != null) {
          try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        drag = null;
      };
      dom.addEventListener("pointerdown", onDown);
      dom.addEventListener("pointermove", onMove);
      dom.addEventListener("pointerup", onUp);
      dom.addEventListener("pointercancel", onUp);

      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth || 320, h = mount.clientHeight || 300;
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      });
      ro.observe(mount);

      const loop = () => { renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
      loop();

      c.cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect();
        dom.removeEventListener("pointerdown", onDown);
        dom.removeEventListener("pointermove", onMove);
        dom.removeEventListener("pointerup", onUp);
        dom.removeEventListener("pointercancel", onUp);
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
    rotRef.current = rot;
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VB} ${VB}"><defs><radialGradient id="dieGrad" cx="0.42" cy="0.36" r="0.72"><stop offset="0" stop-color="#c37a53"/><stop offset="1" stop-color="#a1592f"/></radialGradient></defs><path fill-rule="evenodd" d="${disc} ${holeD}" fill="url(#dieGrad)"/></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = size; c.height = size;
      const g = c.getContext("2d");
      g.fillStyle = "#f4ecdb"; g.fillRect(0, 0, size, size);
      g.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(dataUrlToBytes(c.toDataURL("image/png")));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Outward unit normal of the edge a->b (right-hand side for a CCW polygon).
function edgeNormal2(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  return [dy / L, -dx / L];
}
// Offset a CCW polygon outward by d (enlarges the contour). Fine for small d.
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

// Solid die plate (mm): a disc the thickness of the plate with the handle
// profile cut through it, centred on the origin. The outer rim is chamfered on
// both faces and the hole's entry (bottom) edge is relieved with a lead-in,
// while the hole's exit (top) edge is kept sharp so it defines the profile.
function buildDieGeometry(holeD, chamfer = CHAMFER_MM, topChamfer = TOP_CHAMFER_MM, holeTopChamfer = HOLE_TOP_CHAMFER_MM) {
  const T = DISC_THICK_MM, R = DISC_MM / 2;
  const C = Math.min(chamfer, T / 2 - 0.1);
  const Ctop = Math.min(topChamfer, T / 2 - 0.1);
  const Chole = Math.min(holeTopChamfer, T / 2 - 0.1);
  const zb = -T / 2, zt = T / 2;

  // CCW loops in the xy-plane (mm), all centred on the disc.
  const circle = (r, n = 160) => {
    const a = [];
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; a.push([Math.cos(t) * r, Math.sin(t) * r]); }
    return a;
  };
  const outerFull = circle(R), outerInset = circle(R - C), outerInsetTop = circle(R - Ctop);
  let hole = samplePathMM(holeD, 200);
  let area = 0;
  for (let i = 0; i < hole.length; i++) { const a = hole[i], b = hole[(i + 1) % hole.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) hole = hole.slice().reverse(); // force CCW
  const holeBig = offsetPolygon(hole, C);           // bottom entry lead-in
  const holeTop = offsetPolygon(hole, Chole);        // slight top exit deburr

  const pos = [], idx = [];
  const pushLoop = (pts, z) => { const s = pos.length / 3; for (const p of pts) pos.push(p[0], p[1], z); return s; };
  // Connect lower loop -> upper loop (same vertex count). flip reverses facing.
  const strip = (lo, up, M, flip) => {
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M, A = lo + i, B = lo + j, U = up + i, D = up + j;
      if (flip) idx.push(A, D, B, A, U, D); else idx.push(A, B, D, A, D, U);
    }
  };
  // Triangulated annular cap (outer contour + hole), facing +z (up) or -z.
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

  // Outer wall: chamfer (bottom) -> straight -> chamfer (top).
  const NO = outerFull.length;
  const O0 = pushLoop(outerInset, zb), O1 = pushLoop(outerFull, zb + C);
  const O2 = pushLoop(outerFull, zt - Ctop), O3 = pushLoop(outerInsetTop, zt);
  strip(O0, O1, NO, false); strip(O1, O2, NO, false); strip(O2, O3, NO, false);

  // Hole wall: lead-in chamfer (bottom), straight land, slight chamfer (top).
  const NH = hole.length;
  const H0 = pushLoop(holeBig, zb), H1 = pushLoop(hole, zb + C);
  const H2 = pushLoop(hole, zt - Chole), H3 = pushLoop(holeTop, zt);
  strip(H0, H1, NH, true); strip(H1, H2, NH, true); strip(H2, H3, NH, true);

  // Faces.
  cap(outerInset, holeBig, zb, false);
  cap(outerInsetTop, holeTop, zt, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
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
    chamfer: { size_mm: CHAMFER_MM, topRim_mm: TOP_CHAMFER_MM, holeTop_mm: HOLE_TOP_CHAMFER_MM, edges: "outer rim bottom + hole entry (bottom) = 0.4mm; outer top rim = 0.8mm; hole exit (top) = 0.3mm deburr" },
    printOrientation: "rests on bed (min Z = 0), chamfered entry face down, sharp land face up",
    profile_mm: {
      width: params.sw, height: params.sh, cornerRadius: params.sr,
      grooveDepth: params.gd, grooveWidth: params.grooveW, waistHeight: params.waistH,
    },
  };

  const png = await rasterizeDie(holeD);

  // Orient for slicing: rest the chamfered entry face on the bed (min Z = 0)
  // with the sharp land facing up, so every import lands identically in Bambu.
  const exportGeo = geo.clone();
  exportGeo.translate(0, 0, DISC_THICK_MM / 2);
  const stl = geometryToStl(exportGeo, "die-plate");
  exportGeo.dispose();

  const zip = zipStore([
    { name: "die-spec/die-plate.stl", data: enc.encode(stl) },
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
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc47c55, roughness: 0.82, metalness: 0.04, side: THREE.DoubleSide }));
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
        <div className="eyebrow">Scott Creek Super Duper Clay Gun · 2&quot; wide · 5mm tall</div>
      </header>

      <div className="stage">
        <div className="previews">
          <div className="bench">
            <svg viewBox={`0 0 ${VB} ${VB}`} className="canvas">
              <defs>
                <radialGradient id="dieGrad" cx="0.42" cy="0.36" r="0.72">
                  <stop offset="0" stopColor="#c37a53" />
                  <stop offset="1" stopColor="#a1592f" />
                </radialGradient>
              </defs>
              <path fillRule="evenodd" d={`${ellipsePath(CX, CY, DISC_R, DISC_R)} ${holeD}`} fill="url(#dieGrad)" />
            </svg>
          </div>

          <div className="mugcard">
            <div className="mugcard-label">On a mug</div>
            <MugPreview holeD={holeD} />
          </div>
        </div>

        <aside className="panel">
          <div className="ctl ctl-shapes">
            <div className="shape-row">
              {shapes.map(([id, label]) => (
                <button key={id} className={`shape ${shape === id ? "on" : ""}`} onClick={() => setShape(id)}>
                  <svg className="gly" viewBox="0 0 46 30"><path d={previewD(id)} fill="#5f6b47" /></svg>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ctl ctl-dims">
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
          </div>
        </aside>

        <button className="primary primary-wide" onClick={() => setPreviewOpen(true)}>
          <Download size={15} /> Preview &amp; export
        </button>
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
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Nunito:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
.root{--bench:#f4ecdb;--p:#fbf6ec;--p2:#efe3cd;--line:#ddcdb2;--text:#2e3a3a;--dim:#8a7d66;--accent:#b85c38;--accent2:#5f6b47;
  font-family:'Nunito',system-ui,sans-serif;background:var(--bench);color:var(--text);min-height:100%;padding:20px;box-sizing:border-box;}
.root *{box-sizing:border-box;}
.hd{margin-bottom:16px;text-align:center;}
.eyebrow{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);opacity:.9;}
.hd h1{font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em;}
.stage{display:flex;flex-direction:column;gap:16px;max-width:1180px;margin:0 auto;}
.previews{display:grid;grid-template-columns:1fr 1fr;gap:16px;height:clamp(360px,58vh,620px);}
.bench{display:flex;align-items:center;justify-content:center;min-height:0;min-width:0;background:radial-gradient(120% 120% at 50% 30%,#fbf6ec,#ece0c8);border:1px solid var(--line);border-radius:16px;padding:14px;}
.canvas{width:100%;height:100%;display:block;}
.mugcard{position:relative;display:flex;flex-direction:column;min-height:0;min-width:0;background:radial-gradient(120% 120% at 50% 25%,#fdf9f0,#ece0c8);border:1px solid var(--line);border-radius:16px;padding:12px;}
.mugcard-label{font-family:'Space Mono',monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:2px 2px 8px;}
.mug3d{position:relative;width:100%;flex:1;min-height:0;border-radius:10px;overflow:hidden;cursor:grab;}
.mug3d:active{cursor:grabbing;}
.mug3d canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block;z-index:0;}
.mug-rot{margin-top:12px;}
.zoomctl{position:absolute;right:8px;bottom:8px;display:flex;gap:6px;z-index:2;}
.zoomctl button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;
  background:rgba(251,246,236,.85);color:var(--text);border:1px solid var(--line);border-radius:7px;cursor:pointer;font-family:inherit;transition:.15s;}
.zoomctl button:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
.zoomctl button:disabled{opacity:.35;cursor:default;}
.panel{background:var(--p);border:1px solid var(--line);border-radius:16px;padding:16px;display:grid;grid-template-columns:minmax(220px,1fr) minmax(280px,1.5fr);gap:22px;align-items:start;box-shadow:0 1px 2px rgba(70,55,35,.05);}
.ctl{display:flex;flex-direction:column;gap:12px;min-width:0;}
.shape-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.shape{display:flex;align-items:center;gap:8px;background:var(--p2);border:1px solid var(--line);color:var(--dim);
  padding:9px 10px;border-radius:9px;font-size:12.5px;cursor:pointer;font-family:inherit;transition:.15s;}
.shape:hover{color:var(--text);}
.shape.on{border-color:var(--accent);color:var(--text);background:rgba(184,92,56,.12);}
.gly{width:26px;height:17px;flex:none;}
.unit-row{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--dim);}
.unit-toggle{display:inline-flex;background:var(--p2);border:1px solid var(--line);border-radius:8px;padding:2px;gap:2px;}
.unit-toggle button{border:none;background:none;color:var(--dim);font-family:'Space Mono',monospace;font-size:12px;
  padding:4px 12px;border-radius:6px;cursor:pointer;transition:.15s;}
.unit-toggle button.on{background:var(--accent);color:#fbf6ec;}
.sl{display:flex;flex-direction:column;gap:7px;}
.sl-top{display:flex;justify-content:space-between;font-size:12.5px;color:var(--dim);}
.sl-top b{color:var(--text);font-family:'Space Mono',monospace;font-weight:700;}
.sl input{-webkit-appearance:none;appearance:none;height:4px;border-radius:3px;background:var(--line);outline:none;}
.sl input::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid var(--p);}
.sl input::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid var(--p);}
.readout{background:var(--p2);border:1px solid var(--line);border-radius:11px;padding:11px 13px;display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--dim);}
.readout b{color:var(--text);font-family:'Space Mono',monospace;font-weight:700;}
.primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--accent);color:#fbf6ec;border:none;
  padding:11px;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:.15s;}
.primary:hover{background:#c86a44;}
.primary-wide{width:100%;padding:14px;font-size:14.5px;}
.ghost{display:inline-flex;align-items:center;justify-content:center;background:var(--p2);color:var(--text);border:1px solid var(--line);
  padding:11px 16px;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:.15s;}
.ghost:hover{border-color:var(--dim);}
.modal-backdrop{position:fixed;inset:0;background:rgba(46,40,30,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px;z-index:50;}
.modal{width:min(720px,100%);background:var(--p);border:1px solid var(--line);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(60,45,25,.25);}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
.modal-x{background:none;border:none;color:var(--dim);font-size:22px;line-height:1;cursor:pointer;padding:0 4px;transition:.15s;}
.modal-x:hover{color:var(--text);}
.modal-3d{width:100%;height:min(60vh,440px);background:radial-gradient(120% 120% at 50% 30%,#fdf9f0,#ece0c8);}
.modal-hint{padding:8px 16px 0;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);opacity:.7;text-align:center;}
.modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 16px;}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent2);outline-offset:2px;}
@media (max-width:900px){.previews{grid-template-columns:1fr;height:auto;}.bench{aspect-ratio:1;}.mug3d{height:320px;flex:none;}.panel{grid-template-columns:1fr;}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;}}
`;
