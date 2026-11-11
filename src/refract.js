// Live refraction: the rim of a glass surface bends the page that is really under it.
//
// The method is kube.io's "Liquid Glass in the Browser" (https://kube.io/blog/liquid-glass-css-svg/):
// the glass is a rounded slab with a convex bezel; Snell's law (n = 1.5) gives how far a ray moves
// sideways at each distance from the edge; that goes into the red and green channels of a small map,
// and an SVG feDisplacementMap, run as a backdrop-filter, moves the backdrop by it. Nothing is cloned,
// so it works over video, a scrolling page or anything else.
//
// Only Chromium runs an SVG filter as a backdrop-filter. Other browsers keep the CSS material (blur,
// saturation, tint, rim light, shadow). The stylesheet reads the filter from --gc-lens.

export const LIVE =
  typeof CSS !== 'undefined' && typeof navigator !== 'undefined' &&
  /Chrom(e|ium)\//.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'url(#a)')

// How far a ray moves sideways, by distance from the edge (0 at the edge, 1 where the bezel ends),
// for a bezel shaped like a squircle's shoulder: steep at the edge, flat where it meets the top.
const N = 256
const BEND = (() => {
  const p = new Float32Array(N)
  let max = 0
  for (let i = 0; i < N; i++) {
    const u = 1 - (i + 0.5) / N
    const f = Math.pow(1 - u ** 4, 0.25), slope = Math.pow(1 - u ** 4, -0.75) * u ** 3
    const a = Math.atan(slope), b = Math.asin(Math.sin(a) / 1.5)
    p[i] = (f + 0.5) * Math.tan(a - b)
    if (p[i] > max) max = p[i]
  }
  for (let i = 0; i < N; i++) p[i] /= max
  return p
})()

function map(w, h, r, bezel) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const cx = c.getContext('2d'), img = cx.createImageData(w, h), d = img.data
  const hw = w / 2, hh = h / 2
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const px = i + 0.5 - hw, py = j + 0.5 - hh
    const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r)
    let dist, nx, ny
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); dist = r - l; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py) }
    else if (qx > qy) { dist = hw - Math.abs(px); nx = Math.sign(px); ny = 0 }
    else { dist = hh - Math.abs(py); nx = 0; ny = Math.sign(py) }
    // A convex rim shows what lies further in, so every sample is taken toward the middle.
    const m = dist >= 0 && dist < bezel ? BEND[Math.min(N - 1, Math.floor((dist / bezel) * N))] : 0
    const o = (j * w + i) * 4
    d[o] = 128 - nx * m * 127; d[o + 1] = 128 - ny * m * 127; d[o + 2] = 128; d[o + 3] = 255
  }
  cx.putImageData(img, 0, 0)
  return c.toDataURL()
}

const NS = 'http://www.w3.org/2000/svg'
let defs = null
let uid = 0
const num = (el, name, fallback) => {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(name))
  return Number.isFinite(v) ? v : fallback
}
const el = (name, attrs) => {
  const n = document.createElementNS(NS, name)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  return n
}

/**
 * Give an element's glass a refracting rim. Reads --gc-bezel (px), --gc-refraction (px, the most a ray
 * moves) and --gc-chroma (0 to 0.5, colour split at the rim) from the element's computed style.
 * Returns a function that removes it.
 */
export function refract(host) {
  if (!LIVE) return () => {}
  if (!defs) {
    defs = el('svg', { 'aria-hidden': 'true' })
    defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
    document.body.append(defs)
  }
  const id = `gc-lens-${++uid}`
  const f = el('filter', { id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB', x: 0, y: 0 })
  const im = el('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'm' })
  f.append(im); defs.append(f)
  let key = '', passes = []
  const build = () => {
    const w = Math.round(host.offsetWidth), h = Math.round(host.offsetHeight)
    if (!w || !h || w * h > 1.2e6) return
    const r = Math.min(parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0, w / 2, h / 2)
    const b = Math.min(num(host, '--gc-bezel', 14), w / 2, h / 2)
    const scale = Math.min(num(host, '--gc-refraction', 22), b * 2)
    const chroma = Math.max(0, Math.min(0.5, num(host, '--gc-chroma', 0)))
    const k = `${w},${h},${r},${b},${scale},${chroma}`
    if (k === key) return
    key = k
    for (const n of [f, im]) { n.setAttribute('width', w); n.setAttribute('height', h) }
    im.setAttribute('href', map(w, h, r, b))
    for (const n of passes) n.remove()
    const disp = (s, result) => el('feDisplacementMap', { in: 'SourceGraphic', in2: 'm', scale: s, xChannelSelector: 'R', yChannelSelector: 'G', result })
    if (!chroma) passes = [disp(scale, 'out')]
    else {
      // Red bends a little more than green, blue a little less: three passes, each kept to one channel
      // and added back together. The fringe shows only where the rim moves the backdrop.
      const keep = (ch, inp, result) => {
        const rows = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 1 0']
        rows[ch] = ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][ch]
        return el('feColorMatrix', { in: inp, type: 'matrix', values: rows.join(' '), result })
      }
      const add = (a, b2, result) => el('feComposite', { in: a, in2: b2, operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result })
      passes = [
        disp(scale * (1 + chroma), 'dr'), keep(0, 'dr', 'r'),
        disp(scale, 'dg'), keep(1, 'dg', 'g'),
        disp(scale * (1 - chroma), 'db'), keep(2, 'db', 'b'),
        add('r', 'g', 'rg'), add('rg', 'b', 'out'),
      ]
    }
    f.append(...passes)
    host.style.setProperty('--gc-lens', `url(#${id})`)
  }
  const ro = new ResizeObserver(build)
  ro.observe(host)
  build()
  return () => { ro.disconnect(); f.remove(); host.style.removeProperty('--gc-lens') }
}

// ponytail: one self-check for the bend table; run with `node src/refract.js`.
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('refract.js')) {
  if (!BEND.every((v) => v >= 0 && v <= 1)) throw new Error('bend is not normalised')
  if (!(BEND[0] > BEND[N - 1])) throw new Error('the rim should bend most at the edge')
  console.log('refract: ok')
}
