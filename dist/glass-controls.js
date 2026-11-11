// src/index.js
import { LiquidGlass } from "liquid-glass-js";

// src/refract.js
var LIVE = typeof CSS !== "undefined" && typeof navigator !== "undefined" && /Chrom(e|ium)\//.test(navigator.userAgent) && CSS.supports("backdrop-filter", "url(#a)");
var N = 256;
var BEND = (() => {
  const p = new Float32Array(N);
  let max = 0;
  for (let i = 0; i < N; i++) {
    const u = 1 - (i + 0.5) / N;
    const f = Math.pow(1 - u ** 4, 0.25), slope = Math.pow(1 - u ** 4, -0.75) * u ** 3;
    const a = Math.atan(slope), b = Math.asin(Math.sin(a) / 1.5);
    p[i] = (f + 0.5) * Math.tan(a - b);
    if (p[i] > max) max = p[i];
  }
  for (let i = 0; i < N; i++) p[i] /= max;
  return p;
})();
function map(w, h, r, bezel) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d"), img = cx.createImageData(w, h), d = img.data;
  const hw = w / 2, hh = h / 2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const px = i + 0.5 - hw, py = j + 0.5 - hh;
    const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
    let dist, nx, ny;
    if (qx > 0 && qy > 0) {
      const l = Math.hypot(qx, qy);
      dist = r - l;
      nx = qx / l * Math.sign(px);
      ny = qy / l * Math.sign(py);
    } else if (qx > qy) {
      dist = hw - Math.abs(px);
      nx = Math.sign(px);
      ny = 0;
    } else {
      dist = hh - Math.abs(py);
      nx = 0;
      ny = Math.sign(py);
    }
    const m = dist >= 0 && dist < bezel ? BEND[Math.min(N - 1, Math.floor(dist / bezel * N))] : 0;
    const o = (j * w + i) * 4;
    d[o] = 128 - nx * m * 127;
    d[o + 1] = 128 - ny * m * 127;
    d[o + 2] = 128;
    d[o + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return c.toDataURL();
}
var NS = "http://www.w3.org/2000/svg";
var defs = null;
var uid = 0;
var num = (el2, name, fallback) => {
  const v = parseFloat(getComputedStyle(el2).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};
var el = (name, attrs) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};
function refract(host) {
  if (!LIVE) return () => {
  };
  if (!defs) {
    defs = el("svg", { "aria-hidden": "true" });
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    document.body.append(defs);
  }
  const id = `gc-lens-${++uid}`;
  const f = el("filter", { id, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB", x: 0, y: 0 });
  const im = el("feImage", { x: 0, y: 0, preserveAspectRatio: "none", result: "m" });
  f.append(im);
  defs.append(f);
  let key = "", passes = [];
  const build = () => {
    const w = Math.round(host.offsetWidth), h = Math.round(host.offsetHeight);
    if (!w || !h || w * h > 12e5) return;
    const r = Math.min(parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0, w / 2, h / 2);
    const b = Math.min(num(host, "--gc-bezel", 14), w / 2, h / 2);
    const scale = Math.min(num(host, "--gc-refraction", 22), b * 2);
    const chroma = Math.max(0, Math.min(0.5, num(host, "--gc-chroma", 0)));
    const k = `${w},${h},${r},${b},${scale},${chroma}`;
    if (k === key) return;
    key = k;
    for (const n of [f, im]) {
      n.setAttribute("width", w);
      n.setAttribute("height", h);
    }
    im.setAttribute("href", map(w, h, r, b));
    for (const n of passes) n.remove();
    const disp = (s, result) => el("feDisplacementMap", { in: "SourceGraphic", in2: "m", scale: s, xChannelSelector: "R", yChannelSelector: "G", result });
    if (!chroma) passes = [disp(scale, "out")];
    else {
      const keep = (ch, inp, result) => {
        const rows = ["0 0 0 0 0", "0 0 0 0 0", "0 0 0 0 0", "0 0 0 1 0"];
        rows[ch] = ["1 0 0 0 0", "0 1 0 0 0", "0 0 1 0 0"][ch];
        return el("feColorMatrix", { in: inp, type: "matrix", values: rows.join(" "), result });
      };
      const add = (a, b2, result) => el("feComposite", { in: a, in2: b2, operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result });
      passes = [
        disp(scale * (1 + chroma), "dr"),
        keep(0, "dr", "r"),
        disp(scale, "dg"),
        keep(1, "dg", "g"),
        disp(scale * (1 - chroma), "db"),
        keep(2, "db", "b"),
        add("r", "g", "rg"),
        add("rg", "b", "out")
      ];
    }
    f.append(...passes);
    host.style.setProperty("--gc-lens", `url(#${id})`);
  };
  const ro = new ResizeObserver(build);
  ro.observe(host);
  build();
  return () => {
    ro.disconnect();
    f.remove();
    host.style.removeProperty("--gc-lens");
  };
}
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("refract.js")) {
  if (!BEND.every((v) => v >= 0 && v <= 1)) throw new Error("bend is not normalised");
  if (!(BEND[0] > BEND[N - 1])) throw new Error("the rim should bend most at the edge");
  console.log("refract: ok");
}

// src/index.js
var reduceMQ = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
var clamp = (v, a, b) => Math.min(b, Math.max(a, v));
var Spring = class {
  constructor(x, eps = 0.05, response = 0.3, damping = 0.7) {
    this.x = this.to = x;
    this.v = 0;
    this.eps = eps;
    this.w = 2 * Math.PI / response;
    this.z = damping;
  }
  step(dt) {
    if (reduceMQ.matches) return this.snap();
    const k = this.w * this.w, c = 2 * this.z * this.w, h = dt / 4;
    for (let i = 0; i < 4; i++) {
      this.v += (-k * (this.x - this.to) - c * this.v) * h;
      this.x += this.v * h;
    }
  }
  get still() {
    return Math.abs(this.x - this.to) < this.eps && Math.abs(this.v) < this.eps * 10;
  }
  snap() {
    this.x = this.to;
    this.v = 0;
  }
};
var running = /* @__PURE__ */ new Set();
var raf = 0;
var loop = () => {
  for (const f of running) if (!f()) running.delete(f);
  raf = running.size ? requestAnimationFrame(loop) : 0;
};
var animate = (f) => {
  running.add(f);
  if (!raf) raf = requestAnimationFrame(loop);
};
var guard = (sig, f) => () => !sig.aborted && f();
var Inset = class extends LiquidGlass {
  constructor(host, mount, source, opts) {
    super({ ...opts, background: source, draggable: false, zIndex: 0, x: 0, y: 0 });
    this.host = host;
    for (const n of [this.lensEl, this.glassEl]) {
      n.classList.add("gc-in");
      n.setAttribute("aria-hidden", "true");
    }
    mount.prepend(this.lensEl, this.glassEl);
    this.refresh();
  }
  _bindEvents() {
    this._onSync = () => {
    };
  }
  _cloneBackground() {
    super._cloneBackground();
    const c = this.lensInner.firstElementChild;
    if (!c) return;
    c.querySelectorAll("video, iframe, .gc-knob, .lqg-lens, .lqg-glass").forEach((n) => n.remove());
    for (const n of [c, ...c.querySelectorAll("*")]) {
      n.removeAttribute("id");
      n.style.viewTransitionName = "none";
      if (n instanceof HTMLImageElement) n.loading = "eager";
    }
    c.inert = true;
    c.removeAttribute("role");
    c.removeAttribute("aria-label");
  }
  _syncBg() {
    if (!this.host) {
      this.bgX = this.bgY = 0;
      return;
    }
    const h = this.host.getBoundingClientRect();
    const r = this.background ? this.background.getBoundingClientRect() : h;
    this.bgX = r.left - h.left;
    this.bgY = r.top - h.top;
    this.lensInner.style.width = `${r.width}px`;
    this.lensInner.style.height = `${r.height}px`;
  }
  /** Re-take the picture without rebuilding the maps. */
  reclone() {
    this._cloneBackground();
    this._syncBg();
    this.placeLens();
  }
};
var knobOf = (host) => {
  const k = document.createElement("span");
  k.className = "gc-knob";
  k.setAttribute("aria-hidden", "true");
  host.append(k);
  return k;
};
var sourceOf = (el2, fallback) => el2.closest("[data-glass-scene]") || fallback;
function button(el2, sig, peak = 1.1) {
  const s = new Spring(1, 1e-3), ox = new Spring(0), oy = new Spring(0);
  let held = false, x0 = 0, y0 = 0;
  const frame = guard(sig, () => {
    for (const sp of [s, ox, oy]) sp.step(1 / 60);
    const w = el2.offsetWidth || 1, h = el2.offsetHeight || 1;
    const ax = Math.abs(ox.x) / w, ay = Math.abs(oy.x) / h;
    const sx = s.x * (1 + 0.9 * ax - 0.45 * ay), sy = s.x * (1 + 0.9 * ay - 0.45 * ax);
    el2.style.transform = `translate(${ox.x.toFixed(2)}px, ${oy.x.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    el2.style.setProperty("--gc-p", clamp((s.x - 1) / (peak - 1), 0, 1).toFixed(3));
    const moving = held || ![s, ox, oy].every((sp) => sp.still);
    if (!moving) {
      el2.style.transform = "";
      el2.style.setProperty("--gc-p", "0");
    }
    return moving;
  });
  const light = (e) => {
    const r = el2.getBoundingClientRect();
    el2.style.setProperty("--gc-lx", `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
    el2.style.setProperty("--gc-ly", `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`);
  };
  const on = { signal: sig };
  el2.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    held = true;
    x0 = e.clientX;
    y0 = e.clientY;
    s.to = peak;
    light(e);
    animate(frame);
  }, on);
  addEventListener("pointermove", (e) => {
    if (!held) return;
    light(e);
    const band = (d, r) => Math.sign(d) * r * (1 - Math.exp(-Math.abs(d) / (r * 2.5)));
    ox.to = band(e.clientX - x0, 14);
    oy.to = band(e.clientY - y0, 10);
  }, { passive: true, signal: sig });
  const up = () => {
    if (!held) return;
    held = false;
    s.to = 1;
    ox.to = 0;
    oy.to = 0;
    animate(frame);
  };
  addEventListener("pointerup", up, on);
  addEventListener("pointercancel", up, on);
  return () => {
    for (const p of ["transform", "--gc-p", "--gc-lx", "--gc-ly"]) el2.style.removeProperty(p);
  };
}
function slider(host, sig) {
  const range = host.querySelector('input[type="range"]');
  if (!range) return () => {
  };
  const track = document.createElement("span");
  track.className = "gc-track";
  track.setAttribute("aria-hidden", "true");
  track.append(document.createElement("i"));
  range.before(track);
  host.classList.add("gc-range");
  const W = 64, H = 40, REST = 0.62, RW = W * REST;
  const knob = knobOf(host);
  const g = new Inset(host, knob, sourceOf(host, track), { width: W, height: H, radius: H / 2, scale: 26, depth: 20, curvature: 2.2, chroma: 0.08, edge: 1, glow: 0, blur: 0 });
  const min = +range.min || 0, max = range.max === "" ? 100 : +range.max, step = +range.step || 1;
  const geo = () => {
    const b = host.getBoundingClientRect(), t = track.getBoundingClientRect();
    return { left: b.left, tx: t.left - b.left, tw: t.width, cy: t.top - b.top + t.height / 2 };
  };
  const at = (val, G = geo()) => G.tx + RW / 2 + (val - min) / (max - min) * (G.tw - RW);
  const x = new Spring(at(+range.value), 0.05, 0.28, 0.75), s = new Spring(REST, 1e-3);
  let held = false, px = 0, px0 = 0, f0 = 0, tw0 = 1;
  const frac = () => clamp(f0 + (px - px0) / (tw0 - RW), 0, 1);
  const frame = guard(sig, () => {
    const G = geo();
    if (held) x.to = G.tx + RW / 2 + frac() * (G.tw - RW);
    x.step(1 / 60);
    s.step(1 / 60);
    const st = clamp(Math.abs(x.v) / 2400, 0, 0.28);
    g.moveTo(x.x - W / 2, G.cy - H / 2);
    knob.style.transformOrigin = `${x.x.toFixed(2)}px ${G.cy.toFixed(2)}px`;
    knob.style.transform = `scale(${(s.x * (1 + st)).toFixed(4)}, ${(s.x * (1 - st * 0.45)).toFixed(4)})`;
    knob.style.setProperty("--gc-p", clamp((s.x - REST) / (1 - REST), 0, 1).toFixed(3));
    host.style.setProperty("--gc-fill-w", `${(x.x - G.tx).toFixed(2)}px`);
    return held || !(x.still && s.still);
  });
  const set = () => {
    const val = min + Math.round(frac() * (max - min) / step) * step;
    if (val !== +range.value) {
      range.value = String(val);
      range.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  const on = { signal: sig };
  host.addEventListener("pointerdown", (e) => {
    if (e.button || range.disabled) return;
    e.preventDefault();
    const G = geo(), here = e.clientX - G.left;
    f0 = Math.abs(here - x.x) <= RW / 2 + 6 ? (+range.value - min) / (max - min) : clamp((here - G.tx - RW / 2) / (G.tw - RW), 0, 1);
    held = true;
    px = px0 = e.clientX;
    tw0 = G.tw;
    s.to = 1;
    g.reclone();
    host.setPointerCapture(e.pointerId);
    set();
    animate(frame);
  }, on);
  host.addEventListener("pointermove", (e) => {
    if (held) {
      px = e.clientX;
      set();
    }
  }, on);
  const up = () => {
    if (!held) return;
    held = false;
    s.to = REST;
    x.to = at(+range.value);
    animate(frame);
    range.dispatchEvent(new Event("change", { bubbles: true }));
  };
  host.addEventListener("pointerup", up, on);
  host.addEventListener("pointercancel", up, on);
  range.addEventListener("input", () => {
    if (!held) {
      x.to = at(+range.value);
      animate(frame);
    }
  }, on);
  const ro = new ResizeObserver(() => {
    g.reclone();
    x.to = at(+range.value);
    x.snap();
    animate(frame);
  });
  ro.observe(track);
  animate(frame);
  return () => {
    ro.disconnect();
    g.destroy();
    knob.remove();
    track.remove();
    host.classList.remove("gc-range");
    host.style.removeProperty("--gc-fill-w");
  };
}
function segmented(group, sig) {
  const items = [...group.querySelectorAll("button, a[href]")];
  if (!items.length) return () => {
  };
  group.classList.add("gc-seg");
  const knob = knobOf(group);
  const box = (b) => {
    const g2 = group.getBoundingClientRect(), r = b.getBoundingClientRect();
    return { cx: r.left - g2.left + r.width / 2, cy: r.top - g2.top + r.height / 2, w: r.width, h: Math.round(b.offsetHeight) || 36 };
  };
  const isChosen = (b) => b.getAttribute("aria-pressed") === "true" || b.hasAttribute("aria-current") && b.getAttribute("aria-current") !== "false";
  const chosen = () => items.find(isChosen) ?? items[0];
  let B = box(chosen());
  const radius = (h) => Math.min(h / 2, parseFloat(getComputedStyle(chosen()).borderTopLeftRadius) || h / 2);
  const g = new Inset(group, knob, sourceOf(group, group), { width: Math.round(B.w), height: B.h, radius: radius(B.h), scale: 20, depth: 16, curvature: 2.2, chroma: 0.12, edge: 1, glow: 0, blur: 0 });
  const x = new Spring(B.cx, 0.05, 0.34, 0.68), y = new Spring(B.cy, 0.05, 0.34, 0.68), s = new Spring(1, 1e-3);
  let held = false, dragged = false, x0 = 0, y0 = 0, px = 0, py = 0;
  const size = (w) => {
    if (Math.round(w) !== g.get("width") || B.h !== g.get("height")) g.set({ width: Math.round(w), height: B.h, radius: radius(B.h) });
  };
  const frame = guard(sig, () => {
    const r = group.getBoundingClientRect();
    if (held && dragged) {
      const bs = items.map(box);
      y.to = clamp(py - r.top, Math.min(...bs.map((q) => q.cy)), Math.max(...bs.map((q) => q.cy)));
      const row = bs.filter((q) => Math.abs(q.cy - y.to) < 12);
      const xs = (row.length ? row : bs).map((q) => q.cx);
      x.to = clamp(px - r.left, Math.min(...xs), Math.max(...xs));
    }
    x.step(1 / 60);
    y.step(1 / 60);
    s.step(1 / 60);
    const speed = Math.hypot(x.v, y.v), st = clamp(speed / 2600, 0, 0.25);
    const horiz = Math.abs(x.v) >= Math.abs(y.v);
    const w = g.get("width"), h = g.get("height");
    g.moveTo(x.x - w / 2, y.x - h / 2);
    knob.style.transformOrigin = `${x.x.toFixed(2)}px ${y.x.toFixed(2)}px`;
    const a = s.x * (1 + st), b = s.x * (1 - st * 0.4);
    knob.style.transform = horiz ? `scale(${a.toFixed(4)}, ${b.toFixed(4)})` : `scale(${b.toFixed(4)}, ${a.toFixed(4)})`;
    const p = clamp(Math.max((s.x - 1) / 0.15, speed / 500), 0, 1);
    knob.style.setProperty("--gc-p", p.toFixed(3));
    group.classList.toggle("gc-moving", p > 0.02);
    group.classList.toggle("gc-none", !held && !items.some(isChosen));
    return held || !(x.still && y.still && s.still);
  });
  const goTo = (b) => {
    B = box(b);
    size(B.w);
    x.to = B.cx;
    y.to = B.cy;
    animate(frame);
  };
  const dist = (b) => {
    const q = box(b);
    return Math.hypot(q.cx - x.x, (q.cy - y.x) * 2);
  };
  const nearest = () => items.reduce((a, b) => dist(b) < dist(a) ? b : a);
  const choose = (b) => {
    if (b.tagName !== "BUTTON") return;
    for (const i of items) if (i.tagName === "BUTTON") i.setAttribute("aria-pressed", String(i === b));
  };
  const on = { signal: sig };
  group.addEventListener("click", (e) => {
    const b = e.target.closest("button, a[href]");
    if (b && items.includes(b)) choose(b);
  }, on);
  group.addEventListener("dragstart", (e) => e.preventDefault(), on);
  group.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    held = true;
    dragged = false;
    x0 = px = e.clientX;
    y0 = py = e.clientY;
    s.to = 1.15;
    g.reclone();
    const b = e.target.closest("button, a[href]");
    if (b && items.includes(b) && b !== chosen()) goTo(b);
    animate(frame);
  }, on);
  group.addEventListener("pointermove", (e) => {
    if (!held) return;
    px = e.clientX;
    py = e.clientY;
    if (!dragged && Math.hypot(px - x0, py - y0) > 8) {
      dragged = true;
      group.setPointerCapture(e.pointerId);
      size(B.w);
    }
  }, on);
  const up = (e) => {
    if (!held) return;
    held = false;
    s.to = 1;
    if (dragged && e.type === "pointerup") {
      const b = nearest();
      goTo(b);
      if (b !== chosen()) b.click();
    } else if (dragged) goTo(chosen());
    animate(frame);
  };
  group.addEventListener("pointerup", up, on);
  group.addEventListener("pointercancel", up, on);
  const mo = new MutationObserver(() => {
    goTo(chosen());
    requestAnimationFrame(() => g.reclone());
  });
  mo.observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "aria-current"] });
  const ro = new ResizeObserver(() => {
    B = box(chosen());
    size(B.w);
    g.reclone();
    x.to = B.cx;
    y.to = B.cy;
    x.snap();
    y.snap();
    animate(frame);
  });
  ro.observe(group);
  return () => {
    mo.disconnect();
    ro.disconnect();
    g.destroy();
    knob.remove();
    group.classList.remove("gc-seg", "gc-moving", "gc-none");
  };
}
function init(root = document) {
  const ac = new AbortController(), sig = ac.signal, undo = [];
  if (typeof ResizeObserver === "undefined") return { destroy() {
  } };
  if (LIVE) document.documentElement.classList.add("gc-live");
  const all = (v) => [...root.querySelectorAll(`[data-glass="${v}"]:not(.gc)`)];
  const mark = (el2, f) => {
    el2.classList.add("gc");
    undo.push(() => el2.classList.remove("gc"), f);
  };
  for (const el2 of all("surface")) mark(el2, refract(el2));
  for (const el2 of all("button")) {
    const a = refract(el2), b = button(el2, sig, +el2.dataset.glassPeak || 1.1);
    mark(el2, () => {
      a();
      b();
    });
  }
  for (const el2 of all("slider")) mark(el2, slider(el2, sig));
  for (const el2 of all("segmented")) mark(el2, segmented(el2, sig));
  return { destroy() {
    ac.abort();
    for (const f of undo.reverse()) f();
  } };
}
export {
  LIVE,
  Spring,
  init,
  refract
};
