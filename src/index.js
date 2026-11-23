// glass-controls: a control layer of liquid glass with Apple-style touch physics.
//
// One engine draws all of it: a single WebGL2 context and shader from github.com/bilalgursen/liquid-glass
// (MIT), so the glass bends the same in Chrome, Safari and Firefox.
// 1. Surfaces (surface.ts): a nav capsule, a button over a photo. Each paints the page under it into a
//    texture. A menu is frosted by the browser's own backdrop blur instead.
// 2. Lenses (lens.ts): a slider's thumb, a segmented control's selection, a switch's knob. Flat at rest,
//    clear glass that bends and magnifies what it passes while held or moving.
//
// The touch: a press swells the control on a spring with one small overshoot, a light follows the
// finger, a drag pulls it toward the finger and stretches it the way it moves, and a release springs it
// back. Under prefers-reduced-motion every spring snaps to its target. Without WebGL2, or under reduced
// transparency, higher contrast or forced colors, the stylesheet's material stays.

import { getGlassEngine } from './engine.ts'
import { Lens } from './lens.ts'
import { GLASS, surface } from './surface.ts'

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
const tick = (dt) => { for (const f of running) if (!f(dt)) running.delete(f); return running.size > 0 }
let raf = 0, last = 0
const loop = (t) => {
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 1 / 60)
  last = t
  raf = tick(dt) ? requestAnimationFrame(loop) : 0
  if (!raf) last = 0
}
// First in the engine's list, so springs step before any glass draws in that frame.
let engine, driven = false
const drive = () => {
  if (engine !== undefined) return
  engine = GLASS ? getGlassEngine() : null
  if (!engine) return
  driven = true
  const canvas = document.createElement('canvas')
  engine.add({ canvas, ctx: canvas.getContext('2d'), dirty: false, visible: false, step: tick, lens: () => null, lost: () => { driven = false; if (running.size && !raf) raf = requestAnimationFrame(loop) } })
}
const animate = (f) => { running.add(f); if (driven) engine.wake(); else if (!raf) raf = requestAnimationFrame(loop) }
// A frame that stops for good once its control is destroyed. Wrap once per control, so the Set dedupes.
const guard = (sig, f) => (dt) => !sig.aborted && f(dt)

const knobOf = (host) => {
  const k = document.createElement('span')
  k.className = 'gc-knob'; k.setAttribute('aria-hidden', 'true')
  host.append(k)
  return k
}

// True while a playing film is under this control, so its glass keeps up with it.
const movingUnder = (el) => () => {
  const r = el.getBoundingClientRect()
  for (const m of document.querySelectorAll('video')) {
    if (m.paused) continue
    const b = m.getBoundingClientRect()
    if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) return true
  }
  return false
}

// ---- Button ------------------------------------------------------------------------------------------
function button(el, sig, peak = 1.1) {
  const s = new Spring(1, 0.001), ox = new Spring(0), oy = new Spring(0)
  let held = false, x0 = 0, y0 = 0
  const frame = guard(sig, (dt) => {
    for (const sp of [s, ox, oy]) sp.step(dt)
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
  // Less bend than the tabs: at full strength the rim wraps the dark track round the thumb.
  const g = new Lens(host, knob, { w: W, h: H, r: H / 2, bend: 0.35 })
  const min = +range.min || 0, max = range.max === '' ? 100 : +range.max, step = +range.step || 1
  const geo = () => {
    const b = host.getBoundingClientRect(), t = track.getBoundingClientRect()
    return { left: b.left, tx: t.left - b.left, tw: t.width, cy: t.top - b.top + t.height / 2 }
  }
  const at = (val, G = geo()) => G.tx + RW / 2 + ((val - min) / (max - min)) * (G.tw - RW)
  const x = new Spring(at(+range.value), 0.05, 0.28, 0.75), s = new Spring(REST, 0.001)
  // A drag moves the thumb by how far the finger travels, measured against the track as it was when
  // pressed, so a value that reflows the page cannot feed back into the drag.
  let held = false, px = 0, px0 = 0, f0 = 0, tw0 = 1, pressed = ''
  const frac = () => clamp(f0 + (px - px0) / (tw0 - RW), 0, 1)
  const frame = guard(sig, (dt) => {
    const G = geo()
    if (held) x.to = G.tx + RW / 2 + frac() * (G.tw - RW)
    x.step(dt); s.step(dt)
    const st = clamp(Math.abs(x.v) / 2400, 0, 0.28)
    const fill = x.x - G.tx // at the minimum the thumb's round end would show a sliver of it
    host.style.setProperty('--gc-fill-w', fill <= RW / 2 + 0.5 ? '0px' : `${fill.toFixed(2)}px`)
    g.pose(x.x, G.cy, s.x * (1 + st), s.x * (1 - st * 0.45), clamp((s.x - REST) / (1 - REST), 0, 1) * 0.75) // part white, so the held thumb stays easy to find
    return held || !(x.still && s.still)
  })
  const set = () => {
    const before = range.value
    range.value = String(min + Math.round((frac() * (max - min)) / step) * step) // the browser snaps this to a legal step
    if (range.value !== before) range.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const start = (cx, id) => {
    const G = geo(), here = cx - G.left
    // Pressed on the thumb it picks it up where it is; pressed on the track it jumps there first.
    f0 = Math.abs(here - x.x) <= RW / 2 + 6 ? (+range.value - min) / (max - min) : clamp((here - G.tx - RW / 2) / (G.tw - RW), 0, 1)
    held = true; px = px0 = cx; tw0 = G.tw; s.to = 1; pressed = range.value
    host.dataset.glassPointer = '' // its focus ring is for the keyboard
    range.focus({ preventScroll: true }) // so the arrow keys work after a click
    g.refresh() // re-take the picture under the lens as the finger lands
    try { host.setPointerCapture(id) } catch {} // ponytail: a finger already lifted has no capture to take
    set(); animate(frame)
  }
  // A finger waits to see which way it goes: a page scroll that starts on the track must not move the
  // value. Sideways past 6 px, or a tap, takes the slider; up or down, the browser scrolls and cancels,
  // and the value is put back as it was.
  let down = null
  const on = { signal: sig }
  host.addEventListener('pointerdown', (e) => {
    if (e.button || range.disabled) return
    if (e.pointerType === 'touch') { if (!down && !held) down = { x: e.clientX, y: e.clientY, id: e.pointerId, v: range.value }; return } // a second finger keeps the first's start
    e.preventDefault(); start(e.clientX, e.pointerId)
  }, on)
  host.addEventListener('pointermove', (e) => {
    if (down && !held) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) start(down.x, down.id)
    }
    if (held) { px = e.clientX; set() }
  }, on)
  const up = (e) => {
    if (down && !held && e.type === 'pointerup') start(down.x, down.id) // a tap on the track
    const was = down; down = null
    if (!held) return
    held = false; s.to = REST
    if (e.type === 'pointercancel' && was && range.value !== was.v) { range.value = was.v; range.dispatchEvent(new Event('input', { bubbles: true })) }
    x.to = at(+range.value); animate(frame)
    if (e.type === 'pointerup' && range.value !== pressed) range.dispatchEvent(new Event('change', { bubbles: true }))
  }
  host.addEventListener('pointerup', up, on); host.addEventListener('pointercancel', up, on)
  // Keys move the range; the thumb glides to it.
  const follow = () => { if (!held) { x.to = at(+range.value); animate(frame) } }
  range.addEventListener('input', follow, on)
  for (const t of ['keydown', 'blur']) range.addEventListener(t, () => delete host.dataset.glassPointer, on)
  range.form?.addEventListener('reset', () => setTimeout(follow), on) // the form resets after this event
  const ro = new ResizeObserver(() => { g.refresh(); x.to = at(+range.value); x.snap(); animate(frame) })
  ro.observe(track)
  animate(frame)
  return () => { ro.disconnect(); g.destroy(); knob.remove(); track.remove(); host.classList.remove('gc-range'); host.style.removeProperty('--gc-fill-w'); delete host.dataset.glassPointer }
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
  const vertical = group.getAttribute('aria-orientation') === 'vertical'
  const box = (b) => {
    const g = group.getBoundingClientRect(), r = b.getBoundingClientRect()
    return { cx: r.left - g.left + r.width / 2, cy: r.top - g.top + r.height / 2, w: r.width, h: Math.round(b.offsetHeight) || 36 }
  }
  const isChosen = (b) => b.getAttribute('aria-pressed') === 'true' || (b.hasAttribute('aria-current') && b.getAttribute('aria-current') !== 'false')
  const current = () => items.find(isChosen)
  const chosen = () => current() ?? items[0]
  let B = box(chosen())
  const radius = (h) => Math.min(h / 2, parseFloat(getComputedStyle(chosen()).borderTopLeftRadius) || h / 2)
  const g = new Lens(group, knob, { w: B.w, h: B.h, r: radius(B.h), bend: 0.3, mag: vertical ? 0 : 0.05 }) // more, and the rim catches the label's ends and tops
  const x = new Spring(B.cx, 0.05, 0.34, 0.68), y = new Spring(B.cy, 0.05, 0.34, 0.68), s = new Spring(1, 0.001), wide = new Spring(B.w, 0.05, 0.34, 0.68)
  let held = false, dragged = false, x0 = 0, y0 = 0, px = 0, py = 0, pid = 0, pressedItem = null
  const size = (w) => { wide.to = w; g.h = B.h; g.r = radius(B.h) }
  const frame = guard(sig, (dt) => {
    const r = group.getBoundingClientRect()
    if (held && dragged) {
      // It stays on the items: between the rows' centres, and between the outer items' centres.
      const bs = items.map(box)
      y.to = clamp(py - r.top, Math.min(...bs.map((q) => q.cy)), Math.max(...bs.map((q) => q.cy)))
      const row = bs.filter((q) => Math.abs(q.cy - y.to) < 12)
      const xs = (row.length ? row : bs).map((q) => q.cx)
      x.to = clamp(px - r.left, Math.min(...xs), Math.max(...xs))
      // As wide as the item under it, so its rim never crosses that label.
      wide.to = bs.reduce((a, q) => (Math.hypot(q.cx - x.x, (q.cy - y.x) * 2) < Math.hypot(a.cx - x.x, (a.cy - y.x) * 2) ? q : a)).w
      // Near a scrolling row's end, the row moves so the lens can reach what is cut off.
      const scroller = group.parentElement
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        const e = scroller.getBoundingClientRect()
        scroller.scrollLeft += (px < e.left + 36 ? -420 : px > e.right - 36 ? 420 : 0) * dt
      }
    }
    x.step(dt); y.step(dt); s.step(dt); wide.step(dt)
    // A list with nothing chosen (a menu) shows its pill only under the finger.
    group.classList.toggle('gc-none', !held && !current())
    const speed = Math.hypot(x.v, y.v), st = clamp(speed / 2600, 0, 0.25)
    // Stretched along the way it moves. Glass while it is held or moving, a quiet pill once it rests.
    const horiz = Math.abs(x.v) >= Math.abs(y.v), a = s.x * (1 + st), b = s.x * (1 - st * 0.4)
    g.w = wide.x
    const wider = horiz ? a : b, sx = vertical ? Math.min(wider, 1) : wider // a column's lens stays inside its menu
    // The glass stays on its capsule, even as it overshoots. A scrolling row is left alone: its ends are off screen.
    const cap = group.closest('[data-glass="surface"]'), hw = (g.w * sx) / 2
    let cx = x.x
    if (cap && !/auto|scroll/.test(getComputedStyle(cap).overflowX)) {
      const c = cap.getBoundingClientRect()
      if (c.width >= 2 * hw) cx = clamp(x.x, c.left - r.left + hw, c.right - r.left - hw)
    }
    const open = clamp(Math.max((s.x - 1) / 0.15, speed / 500), 0, 1)
    g.pose(cx, y.x, sx, horiz ? b : a, vertical ? open * 0.6 : open) // part white in a menu, so the row keeps its frost
    return held || !(x.still && y.still && s.still && wide.still)
  })
  const goTo = (b) => { B = box(b); size(B.w); x.to = B.cx; y.to = B.cy; animate(frame) }
  const dist = (b) => { const q = box(b); return Math.hypot(q.cx - x.x, (q.cy - y.x) * 2) } // rows count double: a wrapped row sits close
  const nearest = () => items.reduce((a, b) => (dist(b) < dist(a) ? b : a))
  const choose = (b) => {
    if (b.tagName !== 'BUTTON') return // a link: the page marks aria-current
    for (const i of items) if (i.tagName === 'BUTTON') i.setAttribute('aria-pressed', String(i === b))
  }
  const on = { signal: sig }
  group.addEventListener('click', (e) => { const b = e.target.closest('button, a[href]'); if (b && items.includes(b)) choose(b) }, on)
  // A dragged link would start the browser's own drag and cancel the pointer: the lens drags instead.
  group.addEventListener('dragstart', (e) => e.preventDefault(), on)
  // Chromium leaves a part-shown item cut off when Tab lands on it inside a scrolling row.
  group.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, on)
  group.addEventListener('pointerdown', (e) => {
    if (e.button) return
    held = true; dragged = false; pid = e.pointerId; x0 = px = e.clientX; y0 = py = e.clientY; s.to = 1.15
    g.refresh() // re-take the picture under the lens as the finger lands
    const b = pressedItem = e.target.closest('button, a[href]')
    // Pressing the chosen item picks the glass up; pressing another sends it there.
    if (b && items.includes(b)) {
      if (!current()) { B = box(b); size(B.w); wide.snap(); x.to = B.cx; y.to = B.cy; x.snap(); y.snap() }
      else if (b !== chosen()) goTo(b)
    }
    animate(frame)
  }, on)
  group.addEventListener('pointermove', (e) => {
    if (!held) return
    px = e.clientX; py = e.clientY
    if (!dragged && (vertical ? Math.abs(py - y0) : Math.abs(px - x0)) > 8) { dragged = true; group.setPointerCapture(e.pointerId); size(B.w) }
  }, on)
  // Only a lift chooses. A cancel (the browser took the gesture to scroll) puts the glass back.
  const up = (e) => {
    if (!held || e.pointerId !== pid) return
    held = false; s.to = 1
    // A press let go off its item is no click: the glass goes back.
    if (e.type === 'pointercancel' || (!dragged && e.target.closest?.('button, a[href]') !== pressedItem)) goTo(chosen())
    else if (dragged) { const b = nearest(); goTo(b); if (b !== chosen() || !current()) b.click() } // captured, the native click lands on the group
    animate(frame)
  }
  addEventListener('pointerup', up, on); addEventListener('pointercancel', up, on) // on the window: a press can end outside the group
  const mo = new MutationObserver(() => { goTo(chosen()); g.refresh() })
  mo.observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current'] })
  const ro = new ResizeObserver(() => { B = box(chosen()); size(B.w); wide.snap(); g.refresh(); x.to = B.cx; y.to = B.cy; x.snap(); y.snap(); animate(frame) })
  ro.observe(group)
  animate(frame)
  return () => { mo.disconnect(); ro.disconnect(); g.destroy(); knob.remove(); group.classList.remove('gc-seg', 'gc-none') }
}

// ---- Switch --------------------------------------------------------------------------------------------
// A native checkbox keeps the state, the keys and the screen reader; the switch only shows it. As it
// crosses, the knob swells into clear glass. Track 55 x 24 and knob 32.4 x 20.4 are the engine kit's.
function toggle(host, sig) {
  const input = host.querySelector('input[type="checkbox"]')
  if (!input) return () => {}
  const addedRole = !input.hasAttribute('role')
  if (addedRole) input.setAttribute('role', 'switch')
  const sw = document.createElement('span')
  sw.className = 'gc-sw'; sw.setAttribute('aria-hidden', 'true')
  host.append(sw)
  const knob = knobOf(sw), W = 55, H = 24, KW = 32.4, KH = 20.4, PAD = (H - KH) / 2, PEAK = 1.35
  const g = new Lens(sw, knob, { w: KW, h: KH, r: KH / 2, bend: 0.5 })
  const pos = new Spring(input.checked ? 1 : 0, 0.002, 0.42, 0.7), s = new Spring(0, 0.002)
  let held = false
  const frame = guard(sig, (dt) => {
    pos.to = input.checked ? 1 : 0
    s.to = held || Math.abs(pos.x - pos.to) > 0.08 ? 1 : 0
    pos.step(dt); s.step(dt)
    const p = clamp(s.x, 0, 1), k = 1 + (PEAK - 1) * p
    sw.style.setProperty('--gc-on', clamp(pos.x, 0, 1).toFixed(3))
    g.pose(PAD + KW / 2 + pos.x * (W - KW - 2 * PAD), H / 2, k, k, p * 0.6) // part white, so it never reads as a dark blob on the track
    return held || !(pos.still && s.still)
  })
  const on = { signal: sig }
  host.addEventListener('pointerdown', (e) => { if (!e.button && !input.disabled) { held = true; g.refresh(); animate(frame) } }, on)
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) host.addEventListener(t, () => { held = false; animate(frame) }, on)
  input.addEventListener('change', () => animate(frame), on)
  input.form?.addEventListener('reset', () => setTimeout(() => animate(frame)), on) // the form resets after this event
  animate(frame)
  return () => { g.destroy(); sw.remove(); if (addedRole) input.removeAttribute('role') }
}

let live = 0

/**
 * Wire every [data-glass] control under `root`. Returns { destroy() } to undo it all.
 *   data-glass="surface"    liquid glass (nav capsule, pane); add data-glass-menu for a frosted menu
 *   data-glass="button"     glass button with press, drag and light physics
 *   data-glass="segmented"  a row (or column) of buttons or links with a travelling lens
 *   data-glass="slider"     wraps an <input type="range">; the thumb becomes a lens
 *   data-glass="switch"     wraps an <input type="checkbox">; the knob becomes a lens
 */
export function init(root) {
  const ac = new AbortController(), sig = ac.signal, undo = []
  if (typeof ResizeObserver === 'undefined') return { destroy() {} } // a server, or a very old browser
  root ??= document
  drive()
  const on = !!engine
  const mode = on ? 'gc-live' : 'gc-plain'
  if (!live++) document.documentElement.classList.add(mode)
  const all = (v) => [...root.querySelectorAll(`[data-glass="${v}"]:not(.gc)`)]
  const mark = (el, ...fs) => { el.classList.add('gc'); undo.push(() => el.classList.remove('gc'), ...fs.filter(Boolean)) }
  for (const el of all('surface')) mark(el, el.hasAttribute('data-glass-menu') ? surface(el, { frosted: true }) : on && surface(el, { live: movingUnder(el) }))
  for (const el of all('button')) mark(el, on && surface(el, { swell: true, live: movingUnder(el) }), button(el, sig, +el.dataset.glassPeak || 1.1))
  for (const el of all('switch')) mark(el, toggle(el, sig))
  for (const el of all('slider')) mark(el, slider(el, sig))
  for (const el of all('segmented')) mark(el, segmented(el, sig))
  return {
    destroy() {
      if (sig.aborted) return
      ac.abort()
      for (const f of undo.reverse()) f()
      if (!--live) document.documentElement.classList.remove(mode)
    },
  }
}
