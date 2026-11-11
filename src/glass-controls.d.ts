/** True where the browser runs an SVG filter as a backdrop-filter (Chromium): surfaces refract live. */
export const LIVE: boolean

/** Wire every [data-glass] control under `root` (default: document). Call destroy() to undo it all. */
export function init(root?: ParentNode): { destroy(): void }

/**
 * Give one element a refracting rim, reading --gc-bezel, --gc-refraction and --gc-chroma from its
 * computed style. A no-op outside Chromium. Returns a function that removes it.
 */
export function refract(el: HTMLElement): () => void

/** The damped spring the controls run on, tuned by response (s) and damping ratio. */
export class Spring {
  constructor(x: number, eps?: number, response?: number, damping?: number)
  x: number
  v: number
  to: number
  readonly still: boolean
  step(dt: number): void
  snap(): void
}
