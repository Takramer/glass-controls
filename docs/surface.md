# Surface

```html
<div data-glass="surface" style="--gc-radius: 28px; padding: 20px">…</div>
```

The glass material on any element: tint (`--gc-tint`, `--gc-tint-amount`), frost (`--gc-blur`, `--gc-saturate`), rim light (`--gc-rim`) and shadow (`--gc-shadow`). It works without the script.

A surface that holds rows of text is a menu. Add `data-glass-menu` and it takes Apple's frosted material (`--gc-menu-tint-amount`, `--gc-menu-blur`). Controls stay nearly clear.

With the script, the WebGL2 engine paints the page under the surface and bends it at the rim, in the shape of the element's `border-radius`. Without WebGL2 the surface keeps its CSS material.

Each label inside (`a`, `button`, `label`, `p`, a heading, or anything marked `data-glass-label`) reads what shows through the glass behind it. Over a dark backdrop it turns white with a dark halo.

The page picture leaves out shadows, conic gradients, masks, rotation, `::before`, `::after` and images from another origin without CORS. Over such an element, add `data-glass-backdrop="css"` to it and the glass uses the CSS material. Add `data-glass-skip` to leave an element out of the picture.

Example: [examples/surface.html](../examples/surface.html).
