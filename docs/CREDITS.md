# Credits

## Demo photographs

All six are from Unsplash, used under the [Unsplash License](https://unsplash.com/license) (free to use, no permission needed; credit appreciated). They were cropped to 3:2 and recompressed to stay under 600 KB. They live in `examples/photos/` for the examples and screenshots only; they are not part of the npm package.

| File | Title | Photographer | Page |
|---|---|---|---|
| `neon-signs.jpg` | Neon signs illuminate a city street at night | mos design | https://unsplash.com/photos/SfnOJ6c3ySw |
| `facade-berlin.jpg` | A multicolored building with lots of windows | Cheng Lin | https://unsplash.com/photos/A1Y1KRh9qoU |
| `monstera.jpg` | Large green monstera leaves with natural holes | Maria Lupan | https://unsplash.com/photos/WyXMm6s9LYg |
| `neon-street.jpg` | Tokyo street at night with neon signs and pedestrians | Jezael Melgoza | https://unsplash.com/photos/2uuaV_fI4LU |
| `vertical-lines.jpg` | Modern building facade with repeating vertical lines | Alexander Psiuk | https://unsplash.com/photos/ensfVEUbiJc |
| `glass-building.jpg` | Architectural photography of multicolored glass building | Ricardo Gomez Angel | https://unsplash.com/photos/-Ksr263JEa8 |

## Code

- **liquid-glass**, MIT License, Copyright (c) 2026 Bilal Abdullah Gürşen. https://github.com/bilalgursen/liquid-glass. `src/engine.ts` and `src/dom-snapshot.ts` are copied from it, each with its notice, and the licence is in `src/LICENSE.liquid-glass`. The one change to the engine's code: `surfaceColorOf` walks every ancestor up to `<html>` and falls back to white. `src/surface.ts` and `src/lens.ts` are written after its design.

Version 0.1.0 used liquid-glass-js by Eamon Liu (MIT) for its lenses and kube.io's published refraction method for its rims. Version 0.2.0 uses neither.
