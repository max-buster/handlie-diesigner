import React, { useState, useMemo, useRef, useEffect } from "react";
import { Download } from "lucide-react";
import * as THREE from "three";

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
  const gw = Math.max(W * 0.1, Math.min(gwDesired, (W - 2 * r) * 0.85));
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
function bonePath(cx, cy, W, H) {
  const rl = Math.min(H / 2, W / 2.2);
  const Lx = cx - W / 2 + rl, Rx = cx + W / 2 - rl;
  const waist = rl * 0.5;
  return [
    `M ${fmt(cx - W / 2)} ${fmt(cy)}`,
    `A ${fmt(rl)} ${fmt(rl)} 0 0 1 ${fmt(Lx)} ${fmt(cy - rl)}`,
    `Q ${fmt(cx)} ${fmt(cy - waist)} ${fmt(Rx)} ${fmt(cy - rl)}`,
    `A ${fmt(rl)} ${fmt(rl)} 0 0 1 ${fmt(cx + W / 2)} ${fmt(cy)}`,
    `A ${fmt(rl)} ${fmt(rl)} 0 0 1 ${fmt(Rx)} ${fmt(cy + rl)}`,
    `Q ${fmt(cx)} ${fmt(cy + waist)} ${fmt(Lx)} ${fmt(cy + rl)}`,
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
    case "bone": return bonePath(cx, cy, 36, 15);
    default: return "";
  }
}

// ---- 3D handle sweep ------------------------------------------------------
// Sweep a 2D profile (mm, centred at origin) along a C-shaped handle curve.
// Profile width -> sideways (Z, strap width); profile height -> bend plane (thickness).
function buildHandleGeometry(profilePts) {
  const cps = [
    new THREE.Vector3(38, 31, 0),    // top root, tucked into the wall
    new THREE.Vector3(64, 30, 0),
    new THREE.Vector3(79, 14, 0),
    new THREE.Vector3(81, 0, 0),     // apex
    new THREE.Vector3(79, -14, 0),
    new THREE.Vector3(64, -30, 0),
    new THREE.Vector3(38, -31, 0),   // bottom root
  ];
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

  useEffect(() => {
    const mount = mountRef.current;
    let raf;
    try {
      const W = mount.clientWidth || 320, H = mount.clientHeight || 300;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(33, W / H, 1, 3000);
      camera.position.set(118, 52, 246);
      camera.lookAt(8, 2, 0);
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
      const clay = new THREE.MeshStandardMaterial({ color: 0x9c6f45, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
      const mug = new THREE.Mesh(buildMugGeometry(), clay);
      group.add(mug);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x6b4e30, roughness: 1, side: THREE.DoubleSide }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -32.8; group.add(floor);
      const handle = new THREE.Mesh(new THREE.BufferGeometry(), clay);
      group.add(handle);

      const c = ctx.current;
      Object.assign(c, { scene, camera, renderer, group, handle, mount, auto: true, dragging: false, lx: 0, ly: 0 });

      const onDown = (e) => { c.dragging = true; c.auto = false; c.lx = e.clientX; c.ly = e.clientY; };
      const onMove = (e) => {
        if (!c.dragging) return;
        group.rotation.y += (e.clientX - c.lx) * 0.01;
        group.rotation.x = Math.max(-0.5, Math.min(0.5, group.rotation.x + (e.clientY - c.ly) * 0.006));
        c.lx = e.clientX; c.ly = e.clientY;
      };
      const onUp = () => { c.dragging = false; };
      renderer.domElement.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);

      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth || 320, h = mount.clientHeight || 300;
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      });
      ro.observe(mount);

      const loop = () => { if (!c.dragging && c.auto) group.rotation.y += 0.004; renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
      loop();

      c.cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
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

  return (
    <div className="mug3d" ref={mountRef}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><path ref={pathRef} /></svg>
      <span className="mughint">drag to rotate</span>
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
      case "bone": return bonePath(CX, CY, W, H);
      default: return "";
    }
  }, [shape, sw, sh, sr, gd, grooveW]);

  const exportDie = () => {
    const disc = ellipsePath(CX, CY, DISC_R, DISC_R);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DISC_MM}mm" height="${DISC_MM}mm" viewBox="0 0 ${VB} ${VB}">\n  <path fill-rule="evenodd" d="${disc} ${holeD}" fill="black"/>\n</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "die-plate.svg"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

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
        <div className="eyebrow">Extruder die studio · 2&quot; plate · {DISC_THICK_MM}mm</div>
        <h1>Handle die designer</h1>
      </header>

      <div className="stage">
        <div className="bench">
          <svg viewBox={`0 0 ${VB} ${VB}`} className="canvas">
            <defs>
              <radialGradient id="clay" cx="38%" cy="32%" r="80%">
                <stop offset="0%" stopColor="#ecd6b2" />
                <stop offset="55%" stopColor="#cdac80" />
                <stop offset="100%" stopColor="#9c7c52" />
              </radialGradient>
              <clipPath id="discClip"><circle cx={CX} cy={CY} r={DISC_R} /></clipPath>
            </defs>
            <circle cx={CX} cy={CY} r={DISC_R} fill="url(#clay)" />
            <circle cx={CX} cy={CY} r={DISC_R} fill="none" stroke="#e8b66f" strokeOpacity="0.5" strokeWidth="2" />
            <circle cx={CX} cy={CY} r={DISC_R - 1.5} fill="none" stroke="#5e472b" strokeOpacity="0.6" strokeWidth="3" />
            <g clipPath="url(#discClip)">
              <path d={holeD} fill="#100d09" />
              <path d={holeD} fill="none" stroke="#e08a3c" strokeWidth="1.5" strokeOpacity="0.85" />
              <path d={holeD} fill="none" stroke="#100d09" strokeWidth="0.6" transform="translate(1.4,1.4)" opacity="0.5" />
            </g>
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
            <Slider label={shape === "circle" ? "Diameter" : "Width"} v={sw} set={setSw} min={W_MIN} max={W_MAX} />
            {shape !== "circle" && <Slider label="Height" v={sh} set={setSh} min={H_MIN} max={H_MAX} />}
            {shape === "rrect" && <Slider label="Corner radius" v={sr} set={setSr} min={0} max={Math.min(sw, sh) / 2} />}
            {shape === "thumbgroove" && <Slider label="Groove depth" v={gd} set={setGd} min={1} max={Math.max(2, sh * 0.45)} />}
            {shape === "thumbgroove" && <Slider label="Groove width" v={grooveW} set={setGrooveW} min={4} max={Math.max(6, sw * 0.8)} />}
            <div className="readout">
              <span>Handle profile</span>
              <b>{shape === "circle" ? `${sw.toFixed(1)} mm \u2300` : `${sw.toFixed(1)} \u00d7 ${sh.toFixed(1)} mm`}</b>
            </div>
            <button className="primary" onClick={exportDie}>
              <Download size={15} /> Download die SVG
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, v, set, min, max, step = 0.5 }) {
  return (
    <label className="sl">
      <div className="sl-top"><span>{label}</span><b>{v} mm</b></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(parseFloat(e.target.value))} />
    </label>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
.root{--bench:#16140f;--p:#211d16;--p2:#2b261d;--line:#3a342a;--text:#ece2d0;--dim:#a79c87;--accent:#e08a3c;--accent2:#7fa8ad;
  font-family:'Space Grotesk',system-ui,sans-serif;background:var(--bench);color:var(--text);min-height:100%;padding:20px;box-sizing:border-box;}
.root *{box-sizing:border-box;}
.hd{margin-bottom:16px;}
.eyebrow{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);opacity:.85;}
.hd h1{font-size:26px;font-weight:600;margin:4px 0 0;letter-spacing:-.01em;}
.stage{display:grid;grid-template-columns:1fr 340px;gap:18px;align-items:start;}
.bench{background:radial-gradient(120% 120% at 50% 30%,#221d15,#100e0a);border:1px solid var(--line);border-radius:16px;padding:18px;}
.canvas{width:100%;aspect-ratio:1;display:block;}
.rightcol{display:flex;flex-direction:column;gap:18px;}
.mugcard{position:relative;background:radial-gradient(120% 120% at 50% 25%,#241e15,#0e0c08);border:1px solid var(--line);border-radius:16px;padding:12px;}
.mugcard-label{font-family:'Space Mono',monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:2px 2px 8px;}
.mug3d{position:relative;width:100%;height:300px;border-radius:10px;overflow:hidden;cursor:grab;}
.mug3d:active{cursor:grabbing;}
.mughint{position:absolute;left:10px;bottom:8px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);opacity:.6;pointer-events:none;}
.panel{background:var(--p);border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px;}
.shape-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.shape{display:flex;align-items:center;gap:8px;background:var(--p2);border:1px solid var(--line);color:var(--dim);
  padding:9px 10px;border-radius:9px;font-size:12.5px;cursor:pointer;font-family:inherit;transition:.15s;}
.shape:hover{color:var(--text);}
.shape.on{border-color:var(--accent);color:var(--text);background:rgba(224,138,60,.1);}
.gly{width:26px;height:17px;flex:none;}
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
button:focus-visible,input:focus-visible{outline:2px solid var(--accent2);outline-offset:2px;}
@media (max-width:900px){.stage{grid-template-columns:1fr;}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;}}
`;
