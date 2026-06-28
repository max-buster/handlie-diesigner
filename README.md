# Handle Die Designer

A web tool for designing mug-handle extruder dies. Draw a handle cross-section
(the hole shape) on a to-scale 2" / 3mm plate, preview the extruded handle on a
3D mug, and export the die plate as an SVG.

## Run it

Requires Node 18+.

```bash
npm install
npm run dev
```

Then open the localhost URL it prints (usually http://localhost:5173).

## Build for production

```bash
npm run build
npm run preview
```

## Notes

- The whole UI is one component: `src/die-designer.jsx`. Its styles are injected
  via a `<style>` tag, so there's no Tailwind/PostCSS to configure.
- Dependencies: `react`, `three` (3D mug preview), `lucide-react` (icons).
- Fonts load from Google Fonts; offline they fall back to a system sans-serif.
- The 3D preview avoids `OrbitControls` (drag-to-rotate is hand-rolled), so any
  recent `three` version works.
- Export writes `die-plate.svg`: the 50.8 mm disc with the hole cut out
  (`fill-rule: evenodd`), sized in real millimetres and ready to extrude to a
  3 mm die in your slicer / CAD / Manifold step.

## Tuning knobs (in `die-designer.jsx`)

- `buildMugGeometry()` — the mug silhouette control points (belly, foot, lip).
- `buildHandleGeometry()` — the handle arc control points (`cps`).
- Lighting + clay material live in the `MugPreview` setup effect.
- Plate size / calibration: `DISC_MM`, `DISC_THICK_MM`, `DISC_R`.
