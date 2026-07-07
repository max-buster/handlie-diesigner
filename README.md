# Handle Die Designer

A web tool for designing mug-handle extruder dies. Draw a handle cross-section
(the hole shape) on a to-scale 2" / 5mm plate, preview the extruded handle on a
3D mug, and export a print-ready order pack (STL + preview image + params).

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
- Export ("Preview & export" -> "Download order pack") writes
  `die-order-<timestamp>.zip` containing:
  - `die-spec/die-plate.stl` — the solid 50.8 mm x 5 mm die with the handle
    profile cut through it and chamfered edges, pre-oriented to rest on the bed
    (min Z = 0) so it slices consistently.
  - `die-spec/die-view.png` — a 2D image of the die for visual comparison.
  - `die-spec/params.json` — all profile dimensions, plate size, chamfers, and
    print orientation (`format: "handle-diesigner/v1"`).

## Tuning knobs (in `die-designer.jsx`)

- `buildMugGeometry()` — the mug silhouette control points (belly, foot, lip).
- `buildHandleGeometry()` — the handle arc control points (`cps`).
- Lighting + clay material live in the `MugPreview` setup effect.
- Plate size / calibration: `DISC_MM`, `DISC_THICK_MM`, `DISC_R`.
