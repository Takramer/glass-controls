# Surface

```html
<div data-glass="surface" style="--gc-radius: 28px; padding: 20px">…</div>
```

The glass material on any element: tint (`--gc-tint`, `--gc-tint-amount`), frost (`--gc-blur`, `--gc-saturate`), rim light (`--gc-rim`) and shadow (`--gc-shadow`). It works without the script.

With the script, in Chromium, the rim refracts the live page under it. Three unitless properties tune it, read when the surface is wired and when it resizes:

- `--gc-bezel` (default 14): how far in from the edge the rim curves, in px.
- `--gc-refraction` (default 22): the most a ray moves sideways, in px. Capped at twice the bezel.
- `--gc-chroma` (default 0): colour split at the rim, 0 to 0.5. Three filter passes instead of one.

The refraction keeps its shape to the element's `border-radius`. A surface larger than 1.2 megapixels keeps the material only.

Example: [examples/surface.html](../examples/surface.html). Add `?chroma=0.3` to see the colour split.
