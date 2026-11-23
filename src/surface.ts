// A surface of liquid glass on any element. It paints the page under the element into a texture and
// hands it to the shared WebGL2 engine, so it bends the same way in Chrome, Safari and Firefox. Until
// the first frame, and for good without WebGL2, the element keeps its CSS material.
// After github.com/bilalgursen/liquid-glass, MIT.
import { drawDom } from './dom-snapshot'
import { DESIGN_HEIGHT, SPRINGS, clamp, getGlassEngine, lerp, rgbCss, stepSpring, surfaceColorOf, type GlassLens, type GlassView, type Rgb, type Spring } from './engine'

/** Readers who asked for less keep the plain CSS material. */
export const GLASS = typeof matchMedia !== 'undefined' && !matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)').matches

export type SurfaceOpts = {
  /** A menu: the browser's own backdrop blur, which reads past the menu's edge. The engine's cannot, and smears streaks there. */
  frosted?: boolean
  /** Swells under the pointer and deepens when pressed. */
  swell?: boolean
  /** True while something behind it moves on its own (a playing film). */
  live?: () => boolean
}

// While the page scrolls, one floating surface re-reads the page per frame, and a control scrolling
// into view keeps its CSS material until the scroll settles.
let lastScroll = 0, readFrame: CSSNumberish | null = null
if (typeof window !== 'undefined') addEventListener('scroll', () => { lastScroll = performance.now() }, { passive: true, capture: true })

// A snapshot cannot read canvases, masks or anything else that moves on its own. Glass over an element
// marked data-glass-backdrop="css" hands back to the CSS material, whose backdrop-filter reads real pixels.
const overCssBackdrop = (el: Element) => {
  const r = el.getBoundingClientRect()
  for (const c of document.querySelectorAll('[data-glass-backdrop="css"]')) {
    const b = c.getBoundingClientRect()
    if (b.width && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) return true
  }
  return false
}

// Each label takes the colour that suits what shows through it.
const LABELS = 'a, button, label, p, h1, h2, h3, h4, h5, h6, [data-glass-label]'
const CHOSEN = '[aria-pressed="true"], [aria-current]:not([aria-current="false"])'
const PW = 48, PH = 16
let probeCtx: CanvasRenderingContext2D | null | undefined
const getProbe = () => {
  if (probeCtx === undefined) {
    const c = document.createElement('canvas'); c.width = PW; c.height = PH
    probeCtx = c.getContext('2d', { willReadFrequently: true })
  }
  return probeCtx
}
const linear = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const shade = new Float32Array(PW * PH)
/** Reads the page as it looks through the glass: `t` of the tint `g` over it. */
function readShade(src: CanvasImageSource, x: number, y: number, w: number, h: number, t: number, g: Rgb) {
  const probe = getProbe()
  if (!probe || w < 1 || h < 1) return false
  try {
    probe.drawImage(src, x, y, w, h, 0, 0, PW, PH)
    const d = probe.getImageData(0, 0, PW, PH).data
    for (let i = 0; i < shade.length; i++) shade[i] = 0.2126 * linear(d[i * 4] * (1 - t) + g[0] * 255 * t) + 0.7152 * linear(d[i * 4 + 1] * (1 - t) + g[1] * 255 * t) + 0.0722 * linear(d[i * 4 + 2] * (1 - t) + g[2] * 255 * t)
    return true
  } catch { return false } // a cross-origin image blocks the read
}
/** The 70th-percentile luminance of a box, its edges as shares of the surface. Labels turn white only when most of what shows is dark: a mean lets a few bright stripes pick dark ink over a dark photo, and white reads worse than dark across even stripes. */
function shadeIn(l: number, t: number, r: number, b: number) {
  const x0 = clamp(Math.floor(l * PW), 0, PW - 1), x1 = clamp(Math.ceil(r * PW), x0 + 1, PW), y0 = clamp(Math.floor(t * PH), 0, PH - 1), y1 = clamp(Math.ceil(b * PH), y0 + 1, PH)
  const v: number[] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(shade[y * PW + x])
  return v.sort((a, b) => a - b)[Math.floor(v.length * 0.7)]
}

/** Safari before 17.4 has no checkVisibility. */
export const showing = (el: Element) => (el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : el.getClientRects().length > 0)

const floats = (el: Element | null) => {
  for (; el; el = el.parentElement) if (/fixed|sticky/.test(getComputedStyle(el).position)) return true
  return false
}

/** Mounts the glass. Returns a function that removes it, or null where the engine cannot run. */
export function surface(host: HTMLElement, o: SurfaceOpts = {}): (() => void) | null {
  if (o.frosted) { host.setAttribute('data-glass-host', ''); return () => host.removeAttribute('data-glass-host') }
  const engine = getGlassEngine()
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
  if (!engine || !ctx) return null
  const hs = getComputedStyle(host), over = hs.overflowX + hs.overflowY
  const scrolls = /auto|scroll/.test(over), flat = scrolls || /hidden|clip/.test(over)
  canvas.className = scrolls ? 'gc-canvas gc-stick' : 'gc-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  host.setAttribute('data-glass-host', '')
  if (flat) host.setAttribute('data-glass-clip', '')
  // Last, so a control's :first-child rules hold. In a scroller, first and sticky, so it stays put.
  if (scrolls) host.prepend(canvas); else host.append(canvas)

  let scrolled = false, w = 0, h = 0, corner: number | null = null, tint = 0, blur = 0, labels: HTMLElement[] = [host], padY = 0, padL = 0, moves = false, ready = false, pressed = false, hovered = false
  let surfaceRgb: Rgb = [1, 1, 1], color: Rgb = [1, 1, 1]
  const page = { canvas: document.createElement('canvas'), ctx: null as CanvasRenderingContext2D | null, key: '', at: 0, stale: true, timer: 0 }
  const press: Spring = { x: 0, v: 0 }, growX: Spring = { x: 0, v: 0 }, growY: Spring = { x: 0, v: 0 }
  const unready = () => { if (ready) { ready = false; delete host.dataset.glassReady } }
  // A chosen label keeps the pill's ink: it sits on a white pill.
  const ink = (dark: (el: HTMLElement) => boolean) => {
    for (const el of labels) {
      const next = !(el !== host && el.matches(CHOSEN)) && dark(el)
      if (next !== el.hasAttribute('data-glass-light')) { el.toggleAttribute('data-glass-light', next); if (el === host) view.dirty = true }
    }
  }

  const read = () => {
    w = host.offsetWidth; h = host.offsetHeight
    const st = getComputedStyle(host), rd = st.borderTopLeftRadius
    // A sticky canvas starts at the scroller's content edge: pull it back to the padding edge and out of the flow.
    if (scrolls) {
      const t = (padY = parseFloat(st.paddingTop) || 0), flex = /flex|grid/.test(st.display)
      padL = parseFloat(st.paddingLeft) || 0
      const gapX = flex ? parseFloat(st.columnGap) || 0 : 0, gapY = flex ? parseFloat(st.rowGap) || 0 : 0
      // Sized here too: an undrawn canvas must cancel its own margin or the host collapses.
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
      canvas.style.flex = 'none'; canvas.style.margin = `${-t}px ${padL - w - gapX}px ${t - h - gapY}px ${-padL}px`
    }
    const px = rd.endsWith('%') ? (Math.min(w, h) * parseFloat(rd)) / 100 : parseFloat(rd) || 0
    corner = px >= Math.min(w, h) / 2 - 0.5 ? null : px
    moves = floats(host)
    // The outermost text blocks of this surface, not those of a glass control inside it.
    const own = [...host.querySelectorAll<HTMLElement>(LABELS)].filter((e) => {
      if (e.closest('[data-glass-host]') !== host) return false
      const outer = e.parentElement?.closest(LABELS)
      return !outer || outer === host || !host.contains(outer)
    })
    labels = own.length ? own : [host]
    const s = engine.resolveColor(surfaceColorOf(host.parentElement))
    surfaceRgb = [s[0], s[1], s[2]]
    const c = engine.resolveColor(st.getPropertyValue('--gc-tint').trim() || 'white')
    color = [c[0], c[1], c[2]]
    tint = clamp((parseFloat(st.getPropertyValue('--gc-tint-amount')) || 0) / 100)
    blur = parseFloat(st.getPropertyValue('--gc-blur')) || 0
  }

  const view: GlassView = {
    canvas, ctx, dirty: true, visible: false,
    step: (dt, still) => {
      // Scrolling redraws but does not re-read sizes and colours: that forced a style pass per surface per frame.
      const moved = scrolled; scrolled = false
      if (still) { press.x = growX.x = growY.x = press.v = growX.v = growY.v = 0; return moved }
      const hov = hovered ? 1 : 0
      const a = stepSpring(press, pressed ? 1 : 0, SPRINGS.press, dt)
      const b = stepSpring(growX, hov, SPRINGS.hoverX, dt)
      const c = stepSpring(growY, hov, SPRINGS.hoverY, dt)
      return a || b || c || moved || (view.visible && !!o.live?.())
    },
    lens: (refresh): GlassLens | null => {
      if (refresh) { read(); page.stale = true }
      if (overCssBackdrop(host)) { unready(); return null }
      if (!showing(host)) return null
      if (w < 2 || h < 2) return null
      if (!ready && !moves && performance.now() - lastScroll < 160) {
        if (!page.timer) page.timer = window.setTimeout(() => { page.timer = 0; view.dirty = true; engine.wake() }, 170)
        return null
      }
      const padX = flat ? 0 : 8, padTop = flat ? 0 : 10, padBottom = flat ? 0 : Math.round(h * 0.8 + 4)
      const p = clamp(press.x, -0.12, 1.15), pc = clamp(press.x), unit = h / DESIGN_HEIGHT
      // The element's own transform (the press spring) scales this canvas with it.
      const grow = flat ? 0 : h * 0.08
      const hy = h / 2 + grow * growY.x * (1 + p * 0.1)
      const bevel = lerp(DESIGN_HEIGHT * 0.42, 62, pc)
      const radius = corner === null ? 999 : corner * (hy / (h / 2))
      const rect = host.getBoundingClientRect()
      return {
        left: (scrolls ? -padL : -padX) - host.clientLeft, top: (scrolls ? -padY : -padTop) - host.clientTop, width: w + 2 * padX, height: h + padTop + padBottom, unit,
        cx: padX + w / 2, cy: padTop + h / 2, hx: w / 2 + grow * growX.x, hy, radius, bodyX: 0,
        bevel: corner === null ? bevel : Math.min(bevel, (radius / unit) * 1.2),
        band: corner === null ? undefined : bevel * 0.35,
        shadow: flat ? 0 : 0.12 * lerp(0.55, 1, pc),
        shadowSoftness: 34 * lerp(0.6, 1, pc), shadowOffset: 22 * lerp(0.5, 1, pc),
        strength: 1,
        // The kit's stock shading is built for busy backdrops; on a pale page it reads as a grey ring.
        tune: { inner: 0.22, reflection: 0.25 },
        color, surface: surfaceRgb, edgeClear: 0.2,
        cursorLight: true,
        refraction: {
          paint: (back) => {
            back.translate(padX, padTop)
            back.fillStyle = rgbCss(surfaceRgb)
            back.fillRect(-padX, -padTop, w + 2 * padX, h + padTop + padBottom)
            const r = host.getBoundingClientRect(), lx = r.left + (r.width - w) / 2, ly = r.top + (r.height - h) / 2
            const target = back.canvas, now = performance.now()
            // ponytail: a control in the flow keeps its backdrop as the page scrolls, so only what floats re-reads it.
            const key = moves ? `${target.width}:${target.height}:${Math.round(lx * 2)}:${Math.round(ly * 2)}` : `${target.width}:${target.height}`
            page.ctx ??= page.canvas.getContext('2d')
            const live = !!o.live?.(), frameId = document.timeline.currentTime
            const due = !page.at || (now - page.at > 120 && !(moves && readFrame === frameId))
            // ponytail: one page read per 120 ms per surface, with a last one after the change stops.
            if (!live && !due && !page.timer && (moves || page.stale || key !== page.key)) page.timer = window.setTimeout(() => { page.timer = 0; scrolled = true; engine.wake() }, 120)
            let fresh = false
            if (page.ctx && (live || (due && (page.stale || key !== page.key || moves)))) {
              fresh = true; page.stale = false; page.key = key; page.at = now; if (moves) readFrame = frameId
              if (page.canvas.width !== target.width || page.canvas.height !== target.height) { page.canvas.width = target.width; page.canvas.height = target.height }
              const pg = page.ctx
              pg.setTransform(1, 0, 0, 1, 0, 0); pg.clearRect(0, 0, target.width, target.height); pg.setTransform(back.getTransform())
              drawDom(pg, document.body, {
                origin: { left: lx, top: ly },
                region: { left: lx - padX, top: ly - padTop, right: lx + w + padX, bottom: ly + h + padBottom },
                // Glass never shows other glass.
                skip: (el) => el.hasAttribute('data-glass-host') || el.hasAttribute('data-glass-skip'),
                onStale: () => { page.stale = true; view.dirty = true; engine.wake() },
              })
            }
            back.save(); back.setTransform(1, 0, 0, 1, 0, 0); back.drawImage(page.canvas, 0, 0); back.restore()
            if (fresh) {
              const s = target.width / (w + 2 * padX)
              if (readShade(target, padX * s, padTop * s, w * s, h * s, tint, color)) {
                const b = host.getBoundingClientRect()
                // Near-black and white tie at a luminance of 0.185; the gap either side stops a label flickering there.
                ink((el) => {
                  const q = el === host ? b : el.getBoundingClientRect()
                  const L = shadeIn((q.left - b.left) / b.width, (q.top - b.top) / b.height, (q.right - b.left) / b.width, (q.bottom - b.top) / b.height)
                  return el.hasAttribute('data-glass-light') ? L < 0.21 : L < 0.16
                })
              }
            }
          },
          refract: lerp(44, 37, pc), magnify: 0, dispersion: 0.12, blurCenter: 0, blurEdge: 0,
          frost: tint, blur, blurMix: 1,
        },
        screenX: rect.left + rect.width / 2, screenY: rect.top + rect.height / 2,
      }
    },
    drawn: () => { if (!ready) { ready = true; host.dataset.glassReady = '' } },
    lost: unready,
  }

  const ac = new AbortController(), on = { signal: ac.signal }
  const dirty = () => { view.dirty = true; engine.wake() }
  if (o.swell) {
    const off = () => host.matches(":disabled, [aria-disabled='true']")
    host.addEventListener('pointerdown', () => { if (!off()) { pressed = true; engine.wake() } }, on)
    for (const t of ['pointerup', 'pointercancel']) host.addEventListener(t, () => { pressed = false; engine.wake() }, on)
    host.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !off()) { hovered = true; dirty() } }, on)
    host.addEventListener('pointerleave', () => { pressed = hovered = false; dirty() }, on)
  }
  const io = new IntersectionObserver(([e]) => { view.visible = e.isIntersecting; dirty() }); io.observe(host)
  const ro = new ResizeObserver(dirty); ro.observe(host)
  const mo = new MutationObserver(dirty); mo.observe(host, { attributes: true, attributeFilter: ['class', 'disabled', 'aria-pressed', 'aria-current', 'hidden'] })
  addEventListener('scroll', () => { if (moves) { scrolled = true; engine.wake() } }, { passive: true, capture: true, signal: ac.signal })
  // A menu opening by transition is measured when it starts and again when it lands.
  for (const t of ['transitionrun', 'transitionend']) host.addEventListener(t, (e) => { if (e.target === host) dirty() }, on)
  if (o.live) document.addEventListener('play', dirty, { capture: true, signal: ac.signal })
  let gone = false
  document.fonts?.ready.then(() => { if (!gone) dirty() })
  engine.add(view)

  return () => {
    gone = true; ac.abort(); io.disconnect(); ro.disconnect(); mo.disconnect(); clearTimeout(page.timer)
    engine.remove(view); canvas.remove()
    for (const el of new Set([host, ...labels])) el.removeAttribute('data-glass-light')
    for (const a of ['data-glass-host', 'data-glass-clip', 'data-glass-ready']) host.removeAttribute(a)
  }
}
