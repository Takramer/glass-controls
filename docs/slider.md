# Slider

```html
<label for="v">Volume</label>
<div data-glass="slider"><input id="v" type="range" min="0" max="100" step="1" value="40"></div>
```

The kit draws a track (`--gc-track`, `--gc-track-fill`) and a thumb, and keeps the real range in the page, unseen, for keys and screen readers. Its `input` and `change` events fire as usual. If your code sets `value`, dispatch an `input` event so the thumb follows. A form reset is handled.

- **At rest** the thumb is a white pill.
- **Pressed** it swells into clear glass that bends the track and the page under it.
- **Dragged** it follows the finger without stepping, stretches with its speed, and on release settles on the nearest step. Pressing the track jumps there first.
- **Keys** move the range; the thumb glides to the new value.
- **Focus** puts the two-tone ring on the thumb.

Without the script it is a native range. Without WebGL2 the thumb stays a pill and still moves on its springs.

Example: [examples/slider.html](../examples/slider.html).
