# Button

```html
<button data-glass="button">Play</button>
<button data-glass="button" aria-pressed="false">Follow</button>   <!-- a toggle -->
<button data-glass="button" aria-label="Share"><svg …/></button>   <!-- icon only: label it -->
```

A surface with touch physics:

- **Press:** the whole control, label and all, swells to 1.1 on a spring (0.3 s response, 0.7 damping: one small overshoot). Set `data-glass-peak="1.15"` for a larger swell.
- **Drag while held:** it follows the finger on a rubber band (up to 14 px across and, with a mouse, 10 px down; on touch a vertical move scrolls the page) and stretches the way it is pulled while narrowing the other way, keeping its volume.
- **Light:** a highlight follows the finger inside the button, brightest at the peak of the press.
- **Release:** it springs back.

States: hover raises the tint; `aria-pressed="true"` fills it with `--gc-accent`. Your code toggles `aria-pressed`; the kit only styles it. Focus shows the two-tone `--gc-focus` ring. Minimum size is 44 × 44 px.

Example: [examples/button.html](../examples/button.html).
