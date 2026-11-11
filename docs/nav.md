# Nav capsule and menu

A nav capsule is a surface holding a segmented list of links:

```html
<nav data-glass="surface" aria-label="Main" style="padding: 4px">
  <ul data-glass="segmented">
    <li><a href="/" aria-current="page">Home</a></li>
    <li><a href="/work">Work</a></li>
  </ul>
  <button aria-expanded="false" aria-controls="more">More</button>
</nav>
<div data-glass="surface" id="more" hidden style="--gc-radius: 24px; padding: 6px">
  <ul data-glass="segmented" aria-orientation="vertical">
    <li><a href="/journal">Journal</a></li>
  </ul>
</div>
```

- The current page is marked by your page with `aria-current`; the pill rests there.
- The menu sheet is a **sibling** of the capsule, not a child: glass inside glass loses its backdrop.
- Opening and closing the sheet is your code (the example toggles `hidden` and `aria-expanded` and closes on Escape). The vertical list gives it a pill that follows a finger down the rows and opens the row it lands on.
- Links dragged with a mouse do not start the browser's own link drag; the lens drags instead.

Example: [examples/nav.html](../examples/nav.html).
