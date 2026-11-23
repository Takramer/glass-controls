# Design rules

Glass is easy to overuse. These rules keep it doing one job: lifting controls off the content while keeping them tied to it. They restate Apple's guidance for its own material ([WWDC25 "Meet Liquid Glass"](https://developer.apple.com/videos/play/wwdc2025/219/), [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)) for the web.

1. **Control layer only.** Glass is for what floats over content: a bar, its menus, a toolbar on a photo or a video, a slider over a map. Content itself (cards, articles, images, lists) is never glass.
2. **One depth of glass.** Never stack glass on glass. A `backdrop-filter` on a parent stops the child's backdrop from seeing the page, and two layers of blur read as mud. A menu that drops from a glass bar is the bar's sibling, positioned under it, not its child.
3. **Text contrast floor.** Body text on glass meets WCAG 4.5:1 against the lightest and darkest point of what can pass behind it; large text and icons 3:1. Check over the busiest part of your real content, not over the calm part. The script turns a label white over a dark backdrop, but it cannot fix a backdrop that swings between both inside one word. If a label fails, raise `--gc-tint-amount`. Keep text on glass short: labels, not paragraphs.
4. **Hit targets of 44 px.** Every button, segment and thumb is at least 44 × 44 px to touch. A 36 px segment inside a 4 px padded capsule makes 44.
5. **Capsules, and concentric corners.** Controls are capsules. A shape inside another takes the outer radius minus the padding between them (a 24 px sheet with 6 px padding holds 18 px rows).
6. **Group what belongs together.** Controls that act on the same thing share one piece of glass (a segmented row in one capsule) rather than each floating alone.
7. **Over nothing, no glass.** On a plain page there is nothing to bend. Use a quiet fill there and keep glass for where content passes behind.
8. **Motion is feedback, not decoration.** The springs answer a finger. Nothing moves on its own, and under reduced motion nothing overshoots.
9. **Controls nearly clear, menus frosted.** Apple's clearest glass is still not fully see-through, and its menus are frosted because they hold rows of text. Keep some tint on every control and put `data-glass-menu` on every menu.
