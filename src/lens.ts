// The moving lens: a slider's thumb, a tab's selection, a switch's knob. At rest it is a flat pill in
// CSS. Held or travelling it swells into clear glass that bends and magnifies the labels it passes.
// The optics are the engine's; the caller (index.js) owns the gestures and springs.
// After github.com/bilalgursen/liquid-glass, MIT.
import { GLASS, showing } from './surface'
import { drawDom } from './dom-snapshot'
import { clamp, getGlassEngine, lerp, rgbCss, surfaceColorOf, type GlassLens, type GlassView, type Rgb } from './engine'

const UNITS = 80, OPTICS = (UNITS * 1.35) / 120
/** Inside a scroller a lens cannot pass the control's box: anything past it would add scroll or be cut flat. */
const clipped = (el: Element | null) => {
  for (; el && el !== document.body; el = el.parentElement) if (/auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  return false
}
const icons = new WeakMap<Element, Map<string, HTMLImageElement>>()

function drawIcon(ctx: CanvasRenderingContext2D, el: SVGSVGElement, color: string, x: number, y: number, w: number, h: number, redraw: () => void) {
  let by = icons.get(el)
  if (!by) icons.set(el, (by = new Map()))
  let img = by.get(color)
  if (!img) {
    const c = el.cloneNode(true) as SVGSVGElement
    c.removeAttribute('class'); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', String(w)); c.setAttribute('height', String(h)); c.style.color = color
    img = new Image(); img.onload = redraw
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(c))}`
    by.set(color, img)
  }
  if (img.complete && img.naturalWidth) ctx.drawImage(img, x, y, w, h)
}

const shows = (c: string) => !!c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c)

/** Paints a control into `back` (what the lens bends) and its labels into `front` (what rides on the resting pill). */
function paintControl(back: CanvasRenderingContext2D, front: CanvasRenderingContext2D, root: HTMLElement, selected: string, redraw: () => void) {
  const o = root.getBoundingClientRect()
  // Layout pixels: a menu opening from a smaller scale has on-screen boxes smaller than its layout.
  const k = o.width / (root.offsetWidth || o.width) || 1
  const walk = (el: Element) => {
    if (el instanceof HTMLCanvasElement || el instanceof HTMLInputElement || el.classList.contains('gc-knob')) return
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden') return
    const b = el.getBoundingClientRect(), r = { width: b.width / k, height: b.height / k }, x = (b.left - o.left) / k, y = (b.top - o.top) / k
    if (st.display !== 'contents' && (r.width <= 1 || r.height <= 1)) return // a visually hidden label
    if (el instanceof SVGSVGElement) {
      drawIcon(back, el, st.color, x, y, r.width, r.height, redraw); drawIcon(front, el, selected, x, y, r.width, r.height, redraw)
      return
    }
    if (st.display !== 'contents') {
      const radius = Math.min(parseFloat(st.borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
      if (shows(st.backgroundColor)) { back.beginPath(); back.roundRect(x, y, r.width, r.height, radius); back.fillStyle = st.backgroundColor; back.fill() }
    }
    for (const n of el.childNodes) {
      if (n instanceof Element) walk(n)
      else if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(n)
        const q = range.getBoundingClientRect(), m = { left: (q.left - o.left) / k, top: (q.top - o.top) / k, width: q.width / k, height: q.height / k }
        if (m.width < 1) continue
        const raw = n.textContent.trim(), text = st.textTransform === 'uppercase' ? raw.toUpperCase() : st.textTransform === 'lowercase' ? raw.toLowerCase() : raw
        for (const [ctx, color] of [[back, st.color], [front, selected]] as const) {
          ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`
          ctx.letterSpacing = st.letterSpacing === 'normal' ? '0px' : st.letterSpacing
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color
          const t = ctx.measureText(text)
          ctx.fillText(text, m.left, m.top + (m.height - t.fontBoundingBoxAscent - t.fontBoundingBoxDescent) / 2 + t.fontBoundingBoxAscent)
        }
      }
    }
  }
  walk(root)
}

export class Lens {
  w: number; h: number; r: number; private bend: number; private mag: number
  readonly pill = document.createElement('span')
  private x = 0; private y = 0; private sx = 1; private sy = 1; private p = 0
  private wake = () => {}
  private moved = false
  private nudge = () => {}
  private teardown = () => {}

  constructor(private root: HTMLElement, private knob: HTMLElement, size: { w: number; h: number; r: number; bend?: number; mag?: number }) {
    this.w = size.w; this.h = size.h; this.r = size.r; this.bend = size.bend ?? 1; this.mag = size.mag ?? 0.12
    this.pill.className = 'gc-in gc-pill'
    this.pill.setAttribute('aria-hidden', 'true')
    knob.prepend(this.pill)
    knob.setAttribute('data-glass-skip', '')
    const engine = GLASS ? getGlassEngine() : null, canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
    if (!engine || !ctx) return
    canvas.className = 'gc-canvas'; canvas.setAttribute('aria-hidden', 'true')
    knob.append(canvas)
    let color: Rgb = [1, 1, 1], surface: Rgb = [1, 1, 1], selected = '#111', fit = false
    const redraw = () => { view.dirty = true; engine.wake() }
    // What the control sits over, read once per press: the lens moves, the page under it does not.
    const page = { canvas: document.createElement('canvas'), ctx: null as CanvasRenderingContext2D | null, key: '', stale: true }
    const paintPage = (back: CanvasRenderingContext2D, padX: number, padTop: number, width: number, height: number) => {
      const b = root.getBoundingClientRect(), t = back.canvas, key = `${t.width}:${t.height}:${Math.round(b.left * 2)}:${Math.round(b.top * 2)}`
      page.ctx ??= page.canvas.getContext('2d')
      if (page.ctx && (page.stale || key !== page.key)) {
        page.stale = false; page.key = key
        if (page.canvas.width !== t.width || page.canvas.height !== t.height) { page.canvas.width = t.width; page.canvas.height = t.height }
        const pg = page.ctx
        pg.setTransform(1, 0, 0, 1, 0, 0); pg.clearRect(0, 0, t.width, t.height); pg.setTransform(back.getTransform())
        pg.fillStyle = rgbCss(surface); pg.fillRect(-padX, -padTop, width, height)
        drawDom(pg, document.body, {
          origin: { left: b.left, top: b.top },
          region: { left: b.left - padX, top: b.top - padTop, right: b.left - padX + width, bottom: b.top - padTop + height },
          skip: (el) => el === root || el.hasAttribute('data-glass-host') || el.hasAttribute('data-glass-skip'),
          onStale: () => { page.stale = true; redraw() },
        })
        // The piece of glass this control rides in, so the lens matches what surrounds it.
        const host = root.parentElement?.closest<HTMLElement>('[data-glass-host]')
        if (host?.hasAttribute('data-glass-menu')) {
          // A menu's backdrop is frosted. Shrinking the picture and growing it back blurs it in every browser.
          const tiny = document.createElement('canvas'); tiny.width = Math.max(1, t.width >> 5); tiny.height = Math.max(1, t.height >> 5)
          tiny.getContext('2d')?.drawImage(page.canvas, 0, 0, tiny.width, tiny.height)
          pg.save(); pg.setTransform(1, 0, 0, 1, 0, 0); pg.imageSmoothingQuality = 'high'; pg.drawImage(tiny, 0, 0, t.width, t.height); pg.restore()
        }
        if (host) {
          const st = getComputedStyle(host), c = engine.resolveColor(st.getPropertyValue('--gc-tint').trim() || 'white')
          pg.globalAlpha = clamp((parseFloat(st.getPropertyValue('--gc-tint-amount')) || 0) / 100)
          pg.fillStyle = rgbCss([c[0], c[1], c[2]]); pg.fillRect(-padX, -padTop, width, height); pg.globalAlpha = 1
        }
      }
      back.save(); back.setTransform(1, 0, 0, 1, 0, 0); back.drawImage(page.canvas, 0, 0); back.restore()
    }
    const view: GlassView = {
      canvas, ctx, dirty: true, visible: false,
      step: () => { const m = this.moved; this.moved = false; return m },
      lens: (refresh): GlassLens | null => {
        const pc = clamp(this.p)
        if (pc < 0.004 || !showing(knob)) { delete knob.dataset.live; return null }
        if (refresh) {
          page.stale = true
          const s = engine.resolveColor(surfaceColorOf(root.parentElement)); surface = [s[0], s[1], s[2]]
          const c = engine.resolveColor(getComputedStyle(root).getPropertyValue('--gc-pill').trim() || '#fff'); color = [c[0], c[1], c[2]]
          selected = getComputedStyle(root).getPropertyValue('--gc-pill-ink').trim() || selected
          fit = clipped(root)
        }
        const padX = fit ? 0 : 16, padTop = fit ? 0 : Math.round(this.h * 0.3 + 6), padBottom = fit ? 0 : Math.round(this.h * 1.1 + 8)
        const box = root.getBoundingClientRect(), unit = this.h / UNITS
        const hx = fit ? Math.min((this.w / 2) * this.sx, this.x, root.offsetWidth - this.x) : (this.w / 2) * this.sx
        const hy = fit ? Math.min((this.h / 2) * this.sy, this.y, root.offsetHeight - this.y) : (this.h / 2) * this.sy
        const round = this.r >= Math.min(this.w, this.h) / 2 - 0.5
        const radius = round ? 999 : Math.min(this.r * this.sy, hx, hy)
        const bevel = lerp(UNITS * 0.42, 62 * OPTICS, pc)
        return {
          left: -padX, top: -padTop, width: root.offsetWidth + 2 * padX, height: root.offsetHeight + padTop + padBottom, unit,
          cx: padX + this.x, cy: padTop + this.y, hx, hy, radius, bodyX: 0,
          bevel: round ? bevel : Math.min(bevel, (radius / unit) * 1.2), band: round ? undefined : bevel * 0.35,
          shadow: fit ? 0 : 0.12 * lerp(0.55, 1, pc), shadowSoftness: 34 * OPTICS * lerp(0.6, 1, pc), shadowOffset: 22 * OPTICS * lerp(0.5, 1, pc),
          strength: pc, color, surface, edgeClear: 0, cursorLight: true,
          tune: { inner: 0.22, reflection: 0.25, rim: 0.6 }, // the stock shading goes muddy on a pale page
          refraction: {
            paint: (back, front) => {
              back.translate(padX, padTop); front.translate(padX, padTop)
              paintPage(back, padX, padTop, root.offsetWidth + 2 * padX, root.offsetHeight + padTop + padBottom)
              paintControl(back, front, root, selected, redraw)
            },
            refract: lerp(6, 37, pc) * OPTICS * lerp(0.06, 1, pc) * this.bend, magnify: this.mag * pc, dispersion: 0.12 * pc * this.bend,
            blurCenter: 0, blurEdge: 0, frost: 1 - pc, // 1 is the flat pill, 0 is perfectly clear
          },
          screenX: box.left + this.x, screenY: box.top + this.y,
        }
      },
      drawn: () => { knob.dataset.live = '' },
      lost: () => { delete knob.dataset.live; this.wake = this.nudge = () => {} },
    }
    this.wake = () => { view.dirty = true; engine.wake() }
    this.nudge = () => { this.moved = true; engine.wake() } // redraw without re-reading sizes and colours
    const io = new IntersectionObserver(([e]) => { view.visible = e.isIntersecting; this.wake() }); io.observe(root)
    document.fonts?.ready.then(() => this.wake())
    engine.add(view)
    this.teardown = () => { io.disconnect(); engine.remove(view); this.wake = this.nudge = () => {} }
  }

  /** Place it: centre in the control, stretch on each axis, and how far open it is (0 to 1). */
  pose(x: number, y: number, sx: number, sy: number, p: number) {
    this.x = x; this.y = y; this.sx = sx; this.sy = sy; this.p = p
    const s = this.pill.style
    s.left = `${x - this.w / 2}px`; s.top = `${y - this.h / 2}px`; s.width = `${this.w}px`; s.height = `${this.h}px`; s.borderRadius = `${this.r}px`
    s.transform = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
    this.knob.style.setProperty('--gc-p', p.toFixed(3))
    this.nudge()
  }
  /** What is under it changed. */
  refresh() { this.wake() }
  destroy() { this.teardown(); this.teardown = () => {} }
}
