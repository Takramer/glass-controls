# Switch

```html
<label data-glass="switch"><input type="checkbox" checked> Wi-Fi</label>
<label data-glass="switch"><input type="checkbox" disabled> AirDrop</label>
```

The kit draws a track and a knob and keeps the real checkbox over them, unseen, for pointer, keys and screen readers. It adds `role="switch"` unless the input already has a role. Its `change` event fires as usual. If your code sets `checked`, dispatch a `change` event so the knob follows. A form reset is handled.

- **At rest** the knob is a white pill. The track is `--gc-track` when off and `--gc-accent` when on.
- **Pressed or crossing** the knob swells into glass that bends the track under it, then settles on a spring.
- **Keys:** Tab to it, Space to flip it.
- **Disabled** dims the control and ignores the pointer.
- **Focus** puts the two-tone ring on the track.

Put a group of switches in a `data-glass-menu` surface: rows of text belong on the frosted material.

Without the script it is a native checkbox. Without WebGL2 the knob stays a pill and still moves on its spring.

Example: [examples/switch.html](../examples/switch.html).
