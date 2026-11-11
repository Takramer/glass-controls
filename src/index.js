// glass-controls: a control layer of glass with Apple-style touch physics.
//
// Two optics, each where it is strongest:
// 1. Surfaces (a nav capsule, a menu sheet, a button over a photo) are live glass: refract.js bends
//    the real page under them (Chromium), and glass-controls.css gives the material everywhere.
// 2. Lenses (a slider's thumb, a segmented control's selection) magnify what they pass. They use
//    liquid-glass-js (github.com/eamonliu/liquid-glass-js, MIT, Eamon Liu), which refracts a clone of
//    what is under the lens, so lenses work in Safari and Firefox too.
//
// The touch: a press swells the control on a spring with one small overshoot, a light follows the
// finger, a drag pulls it toward the finger and stretches it the way it moves, and a release springs it
// back. Under prefers-reduced-motion every spring snaps to its target.

import { LiquidGlass } from 'liquid-glass-js'
import { LIVE, refract } from './refract.js'

export { LIVE, refract }

const reduceMQ = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ---- Springs, on one shared frame loop ------------------------------------------------------------
// Tuned by response (seconds) and damping ratio, as Apple's are. 0.3 s at 0.7 settles with one small
// overshoot. Four sub-steps a frame keep it stable on long frames.
export class Spring {
  constructor(x, eps = 0.05, response = 0.3, damping = 0.7) {
    this.x = this.to = x; this.v = 0; this.eps = eps; this.w = (2 * Math.PI) / response; this.z = damping
  }
  step(dt) {
    if (reduceMQ.matches) return this.snap()
    const k = this.w * this.w, c = 2 * this.z * this.w, h = dt / 4
    for (let i = 0; i < 4; i++) { this.v += (-k * (this.x - this.to) - c * this.v) * h; this.x += this.v * h }
  }
  get still() { return Math.abs(this.x - this.to) < this.eps && Math.abs(this.v) < this.eps * 10 }
  snap() { this.x = this.to; this.v = 0 }
}

const running = new Set() // each frame returns true while it still has to move
let raf = 0
const loop = () => {
  for (const f of running) if (!f()) running.delete(f)
  raf = running.size ? requestAnimationFrame(loop) : 0
}
const animate = (f) => { running.add(f); if (!raf) raf = requestAnimationFrame(loop) }
// A frame that stops for good once its control is destroyed. Wrap once per control, so the Set dedupes.
const guard = (sig, f) => () => !sig.aborted && f()

// ---- A lens that lives inside its host -------------------------------------------------------------
// liquid-glass-js pins its glass to the window and follows scroll; here the lens and its glass go into
// a mount inside the host, and every position is measured from the host's corner.
// ponytail: overrides three underscore methods of liquid-glass-js 0.1.0, so the version is pinned.
// Upgrade path: a public "mount in host" option upstream.
class Inset extends LiquidGlass {
  constructor(host, mount, source, opts) {
    super({ ...opts, background: source, draggable: false, zIndex: 0, x: 0, y: 0 })
    this.host = host
    for (const n of [this.lensEl, this.glassEl]) { n.classList.add('gc-in'); n.setAttribute('aria-hidden', 'true') }
    mount.prepend(this.lensEl, this.glassEl)
    this.refresh()
  }
  _bindEvents() { this._onSync = () => {} }
  _cloneBackground() {
    super._cloneBackground()
    const c = this.lensInner.firstElementChild
    if (!c) return
    // The clone is a picture only: no lenses, no video, no ids, nothing focusable.
    c.querySelectorAll('video, iframe, .gc-knob, .lqg-lens, .lqg-glass').forEach((n) => n.remove())
    for (const n of [c, ...c.querySelectorAll('*')]) {
      n.removeAttribute('id'); n.style.viewTransitionName = 'none'
      if (n instanceof HTMLImageElement) n.loading = 'eager'
    }
    c.inert = true; c.removeAttribute('role'); c.removeAttribute('aria-label')
  }
  _syncBg() {
    if (!this.host) { this.bgX = this.bgY = 0; return }
    const h = this.host.getBoundingClientRect()
    const r = this.background ? this.background.getBoundingClientRect() : h
    this.bgX = r.left - h.left; this.bgY = r.top - h.top
    this.lensInner.style.width = `${r.width}px`; this.lensInner.style.height = `${r.height}px`
  }
  /** Re-take the picture without rebuilding the maps. */
  reclone() { this._cloneBackground(); this._syncBg(); this.placeLens() }
}

const knobOf = (host) => {
  const k = document.createElement('span')
  k.className = 'gc-knob'; k.setAttribute('aria-hidden', 'true')
  host.append(k)
  return k
}
// What a lens shows: the nearest [data-glass-scene] (a photo, a page section), else the control itself.
const sourceOf = (el, fallback) => el.closest('[data-glass-scene]') || fallback

// ---- Button ------------------------------------------------------------------------------------------
function button(el, sig, peak = 1.1) {
  const s = new Spring(1, 0.001), ox = new Spring(0), oy = new Spring(0)
  let held = false, x0 = 0, y0 = 0
  const frame = guard(sig, () => {
    for (const sp of [s, ox, oy]) sp.step(1 / 60)
    const w = el.offsetWidth || 1, h = el.offsetHeight || 1
    // Pulled sideways it grows that way and narrows the other, keeping its volume, like a drop.
    const ax = Math.abs(ox.x) / w, ay = Math.abs(oy.x) / h
    const sx = s.x * (1 + 0.9 * ax - 0.45 * ay), sy = s.x * (1 + 0.9 * ay - 0.45 * ax)
    el.style.transform = `translate(${ox.x.toFixed(2)}px, ${oy.x.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
    el.style.setProperty('--gc-p', clamp((s.x - 1) / (peak - 1), 0, 1).toFixed(3))
    const moving = held || ![s, ox, oy].every((sp) => sp.still)
    if (!moving) { el.style.transform = ''; el.style.setProperty('--gc-p', '0') }
    return moving
  })
  const light = (e) => {
    const r = el.getBoundingClientRect()
    el.style.setProperty('--gc-lx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
    el.style.setProperty('--gc-ly', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
  }
  const on = { signal: sig }
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return
    held = true; x0 = e.clientX; y0 = e.clientY; s.to = peak; light(e)
    animate(frame)
  }, on)
  addEventListener('pointermove', (e) => {
    if (!held) return
    light(e)
    // Rubber band: it follows the finger at first, then less and less, up to about 14 px.
    const band = (d, r) => Math.sign(d) * r * (1 - Math.exp(-Math.abs(d) / (r * 2.5)))
    ox.to = band(e.clientX - x0, 14); oy.to = band(e.clientY - y0, 10)
  }, { passive: true, signal: sig })
  const up = () => { if (!held) return; held = false; s.to = 1; ox.to = 0; oy.to = 0; animate(frame) }
  addEventListener('pointerup', up, on); addEventListener('pointercancel', up, on)
  return () => { for (const p of ['transform', '--gc-p', '--gc-lx', '--gc-ly']) el.style.removeProperty(p) }
}

// ---- Slider ------------------------------------------------------------------------------------------
// At rest the thumb is a white pill. Pressed, it swells into clear glass that magnifies the track under
// it, follows the finger without stepping, stretches with its speed, and on release settles on the
// nearest step. The native range stays in the page, unseen, for keys and screen readers.
function slider(host, sig) {
  const range = host.querySelector('input[type="range"]')
  if (!range) return () => {}
  const track = document.createElement('span')
  track.className = 'gc-track'; track.setAttribute('aria-hidden', 'true')
  track.append(document.createElement('i')); range.before(track)
  host.classList.add('gc-range')
  const W = 64, H = 40, REST = 0.62, RW = W * REST
  const knob = knobOf(host)
  const g = new Inset(host, knob, sourceOf(host, track), { width: W, height: H, radius: H / 2, scale: 26, depth: 20, curvature: 2.2, chroma: 0.08, edge: 1, glow: 0, blur: 0 })
  const min = +range.min || 0, max = range.max === '' ? 100 : +range.max, step = +range.step || 1
  const geo = () => {
    const b = host.getBoundingClientRect(), t = track.getBoundingClientRect()
    return { left: b.left, tx: t.left - b.left, tw: t.width, cy: t.top - b.top + t.height / 2 }
  }
  const at = (val, G = geo()) => G.tx + RW / 2 + ((val - min) / (max - min)) * (G.tw - RW)
  const x = new Spring(at(+range.value), 0.05, 0.28, 0.75), s = new Spring(REST, 0.001)
  // A drag moves the thumb by how far the finger travels, measured against the track as it was when
  // pressed, so a value that reflows the page cannot feed back into the drag.
  let held = false, px = 0, px0 = 0, f0 = 0, tw0 = 1
  const frac = () => clamp(f0 + (px - px0) / (tw0 - RW), 0, 1)
  const frame = guard(sig, () => {
    const G = geo()
    if (held) x.to = G.tx + RW / 2 + frac() * (G.tw - RW)
    x.step(1 / 60); s.step(1 / 60)
    const st = clamp(Math.abs(x.v) / 2400, 0, 0.28)
    g.moveTo(x.x - W / 2, G.cy - H / 2)
    knob.style.transformOrigin = `${x.x.toFixed(2)}px ${G.cy.toFixed(2)}px`
    knob.style.transform = `scale(${(s.x * (1 + st)).toFixed(4)}, ${(s.x * (1 - st * 0.45)).toFixed(4)})`
    knob.style.setProperty('--gc-p', clamp((s.x - REST) / (1 - REST), 0, 1).toFixed(3))
    host.style.setProperty('--gc-fill-w', `${(x.x - G.tx).toFixed(2)}px`)
    return held || !(x.still && s.still)
  })
  const set = () => {
    const val = min + Math.round((frac() * (max - min)) / step) * step
    if (val !== +range.value) { range.value = String(val); range.dispatchEvent(new Event('input', { bubbles: true })) }
  }
  const on = { signal: sig }
  host.addEventListener('pointerdown', (e) => {
    if (e.button || range.disabled) return
    e.preventDefault()
    const G = geo(), here = e.clientX - G.left
    // Pressed on the thumb it picks it up where it is; pressed on the track it jumps there first.
    f0 = Math.abs(here - x.x) <= RW / 2 + 6 ? (+range.value - min) / (max - min) : clamp((here - G.tx - RW / 2) / (G.tw - RW), 0, 1)
    held = true; px = px0 = e.clientX; tw0 = G.tw; s.to = 1
    g.reclone()
    host.setPointerCapture(e.pointerId); set(); animate(frame)
  }, on)
  host.addEventListener('pointermove', (e) => { if (held) { px = e.clientX; set() } }, on)
  const up = () => {
    if (!held) return
    held = false; s.to = REST; x.to = at(+range.value); animate(frame)
    range.dispatchEvent(new Event('change', { bubbles: true }))
  }
  host.addEventListener('pointerup', up, on); host.addEventListener('pointercancel', up, on)
  // Keys move the range; the thumb glides to it.
  range.addEventListener('input', () => { if (!held) { x.to = at(+range.value); animate(frame) } }, on)
  const ro = new ResizeObserver(() => { g.reclone(); x.to = at(+range.value); x.snap(); animate(frame) })
  ro.observe(track)
  animate(frame)
  return () => { ro.disconnect(); g.destroy(); knob.remove(); track.remove(); host.classList.remove('gc-range'); host.style.removeProperty('--gc-fill-w') }
}

// ---- Segmented control (and any list with one chosen item) --------------------------------------------
// A pill sits behind the chosen item. Choosing another, it slides there and, while it moves, turns to
// clear glass that magnifies the labels it passes. It can be dragged along the row; let go, it lands on
// the nearest item and chooses it. Buttons are chosen with aria-pressed, links with aria-current.
function segmented(group, sig) {
  const items = [...group.querySelectorAll('button, a[href]')]
  if (!items.length) return () => {}
  group.classList.add('gc-seg')
  const knob = knobOf(group)
  const box = (b) => {
    const g = group.getBoundingClientRect(), r = b.getBoundingClientRect()
    return { cx: r.left - g.left + r.width / 2, cy: r.top - g.top + r.height / 2, w: r.width, h: Math.round(b.offsetHeight) || 36 }
  }
  const isChosen = (b) => b.getAttribute('aria-pressed') === 'true' || (b.hasAttribute('aria-current') && b.getAttribute('aria-current') !== 'false')
  const chosen = () => items.find(isChosen) ?? items[0]
  let B = box(chosen())
  const radius = (h) => Math.min(h / 2, parseFloat(getComputedStyle(chosen()).borderTopLeftRadius) || h / 2)
  const g = new Inset(group, knob, sourceOf(group, group), { width: Math.round(B.w), height: B.h, radius: radius(B.h), scale: 20, depth: 16, curvature: 2.2, chroma: 0.12, edge: 1, glow: 0, blur: 0 })
  const x = new Spring(B.cx, 0.05, 0.34, 0.68), y = new Spring(B.cy, 0.05, 0.34, 0.68), s = new Spring(1, 0.001)
  let held = false, dragged = false, x0 = 0, y0 = 0, px = 0, py = 0
  const size = (w) => { if (Math.round(w) !== g.get('width') || B.h !== g.get('height')) g.set({ width: Math.round(w), height: B.h, radius: radius(B.h) }) }
  const frame = guard(sig, () => {
    const r = group.getBoundingClientRect()
    if (held && dragged) {
      // It stays on the items: between the rows' centres, and between the outer items' centres.
      const bs = items.map(box)
      y.to = clamp(py - r.top, Math.min(...bs.map((q) => q.cy)), Math.max(...bs.map((q) => q.cy)))
      const row = bs.filter((q) => Math.abs(q.cy - y.to) < 12)
      const xs = (row.length ? row : bs).map((q) => q.cx)
      x.to = clamp(px - r.left, Math.min(...xs), Math.max(...xs))
    }
    x.step(1 / 60); y.step(1 / 60); s.step(1 / 60)
    const speed = Math.hypot(x.v, y.v), st = clamp(speed / 2600, 0, 0.25)
    // Stretched along the way it moves.
    const horiz = Math.abs(x.v) >= Math.abs(y.v)
    const w = g.get('width'), h = g.get('height')
    g.moveTo(x.x - w / 2, y.x - h / 2)
    knob.style.transformOrigin = `${x.x.toFixed(2)}px ${y.x.toFixed(2)}px`
    const a = s.x * (1 + st), b = s.x * (1 - st * 0.4)
    knob.style.transform = horiz ? `scale(${a.toFixed(4)}, ${b.toFixed(4)})` : `scale(${b.toFixed(4)}, ${a.toFixed(4)})`
    // Glass while it is held or moving, a quiet pill once it rests.
    const p = clamp(Math.max((s.x - 1) / 0.15, speed / 500), 0, 1)
    knob.style.setProperty('--gc-p', p.toFixed(3))
    // At rest the labels sit on the pill; while the lens moves it covers them with its magnified copy.
    group.classList.toggle('gc-moving', p > 0.02)
    // A list with nothing chosen (a menu) shows its pill only under the finger.
    group.classList.toggle('gc-none', !held && !items.some(isChosen))
    return held || !(x.still && y.still && s.still)
  })
  const goTo = (b) => { B = box(b); size(B.w); x.to = B.cx; y.to = B.cy; animate(frame) }
  const dist = (b) => { const q = box(b); return Math.hypot(q.cx - x.x, (q.cy - y.x) * 2) }
  const nearest = () => items.reduce((a, b) => (dist(b) < dist(a) ? b : a))
  const choose = (b) => {
    if (b.tagName !== 'BUTTON') return // a link: the page marks aria-current
    for (const i of items) if (i.tagName === 'BUTTON') i.setAttribute('aria-pressed', String(i === b))
  }
  const on = { signal: sig }
  group.addEventListener('click', (e) => { const b = e.target.closest('button, a[href]'); if (b && items.includes(b)) choose(b) }, on)
  // A dragged link would start the browser's own drag and cancel the pointer: the lens drags instead.
  group.addEventListener('dragstart', (e) => e.preventDefault(), on)
  group.addEventListener('pointerdown', (e) => {
    if (e.button) return
    held = true; dragged = false; x0 = px = e.clientX; y0 = py = e.clientY; s.to = 1.15
    g.reclone() // the copy under the lens is a snapshot: re-take it as the finger lands
    const b = e.target.closest('button, a[href]')
    // Pressing the chosen item picks the glass up; pressing another sends it there.
    if (b && items.includes(b) && b !== chosen()) goTo(b)
    animate(frame)
  }, on)
  group.addEventListener('pointermove', (e) => {
    if (!held) return
    px = e.clientX; py = e.clientY
    if (!dragged && Math.hypot(px - x0, py - y0) > 8) { dragged = true; group.setPointerCapture(e.pointerId); size(B.w) }
  }, on)
  const up = (e) => {
    if (!held) return
    held = false; s.to = 1
    // Captured, the native click lands on the group, so a drag chooses by clicking the item itself.
    if (dragged && e.type === 'pointerup') { const b = nearest(); goTo(b); if (b !== chosen()) b.click() }
    else if (dragged) goTo(chosen())
    animate(frame)
  }
  group.addEventListener('pointerup', up, on); group.addEventListener('pointercancel', up, on)
  const mo = new MutationObserver(() => { goTo(chosen()); requestAnimationFrame(() => g.reclone()) })
  mo.observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current'] })
  const ro = new ResizeObserver(() => { B = box(chosen()); size(B.w); g.reclone(); x.to = B.cx; y.to = B.cy; x.snap(); y.snap(); animate(frame) })
  ro.observe(group)
  return () => { mo.disconnect(); ro.disconnect(); g.destroy(); knob.remove(); group.classList.remove('gc-seg', 'gc-moving', 'gc-none') }
}

/**
 * Wire every [data-glass] control under `root`. Returns { destroy() } to undo it all.
 *   data-glass="surface"    live glass material (nav capsule, menu sheet, pane)
 *   data-glass="button"     glass button with press, drag and light physics
 *   data-glass="segmented"  a row (or column) of buttons or links with a travelling lens
 *   data-glass="slider"     wraps an <input type="range">; the thumb becomes a lens
 */
export function init(root = document) {
  const ac = new AbortController(), sig = ac.signal, undo = []
  if (typeof ResizeObserver === 'undefined') return { destroy() {} }
  if (LIVE) document.documentElement.classList.add('gc-live')
  const all = (v) => [...root.querySelectorAll(`[data-glass="${v}"]:not(.gc)`)]
  const mark = (el, f) => { el.classList.add('gc'); undo.push(() => el.classList.remove('gc'), f) }
  for (const el of all('surface')) mark(el, refract(el))
  for (const el of all('button')) {
    const a = refract(el), b = button(el, sig, +el.dataset.glassPeak || 1.1)
    mark(el, () => { a(); b() })
  }
  for (const el of all('slider')) mark(el, slider(el, sig))
  for (const el of all('segmented')) mark(el, segmented(el, sig))
  return { destroy() { ac.abort(); for (const f of undo.reverse()) f() } }
}
