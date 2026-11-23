# Segmented control

```html
<div data-glass="surface" style="padding: 4px">
  <div data-glass="segmented" role="group" aria-label="Range">
    <button aria-pressed="true">Day</button>
    <button aria-pressed="false">Week</button>
    <button aria-pressed="false">Month</button>
  </div>
</div>
```

The segmented element holds the items and draws no material of its own; the surface around it is the track.

- **Items** are buttons (chosen with `aria-pressed="true"`; the kit sets it on click) or links (chosen with `aria-current`; your page sets it). Items may sit directly in the element or one level down in `<li>`.
- **At rest** the chosen item sits on a white pill (`--gc-pill`).
- **Choosing another,** the pill slides there on a spring and, while it moves, turns to clear glass that magnifies the labels it passes and stretches along its way.
- **Dragging:** press the chosen item and drag; the lens follows the finger between the outer items and, on release, lands on the nearest and chooses it (by clicking it, so your handlers run).
- **Vertical:** add `aria-orientation="vertical"` for a column (a menu). With nothing chosen the pill shows only under the finger.

The lens bends the page under it, read when a finger lands, and the labels it passes. Inside a `data-glass-menu` surface that page is frosted to match.

Keyboard: Tab to an item, Enter or Space to choose it; the lens follows. Arrow-key roving focus is not built in; add it if your group needs radio semantics.

Example: [examples/segmented.html](../examples/segmented.html).
