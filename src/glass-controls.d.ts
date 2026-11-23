/**
 * Wire every [data-glass] control under `root` (default: document).
 * Call destroy() to remove the glass, listeners and added elements.
 */
export function init(root?: ParentNode): { destroy(): void }

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
