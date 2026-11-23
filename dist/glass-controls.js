// src/engine.ts
function stepSpring(s, target, { omega, zeta }, dt) {
  const d = s.x - target;
  if (zeta > 0.9995) {
    const b = s.v + omega * d;
    const e = Math.exp(-omega * dt);
    s.x = target + (d + b * dt) * e;
    s.v = (s.v - omega * b * dt) * e;
  } else {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const b = (s.v + zeta * omega * d) / wd;
    const e = Math.exp(-zeta * omega * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    const x = (d * cos + b * sin) * e;
    s.x = target + x;
    s.v = e * wd * (b * cos - d * sin) - zeta * omega * x;
  }
  const scale = Math.max(1, Math.abs(target));
  const settled = Math.abs(s.x - target) < 5e-4 * scale && Math.abs(s.v) < 5e-3 * scale;
  if (settled) {
    s.x = target;
    s.v = 0;
  }
  return !settled;
}
var SPRINGS = {
  press: { omega: 16, zeta: 0.6 },
  hoverX: { omega: 17, zeta: 0.42 },
  hoverY: { omega: 12, zeta: 0.34 },
  /** A droplet separating from the body: slow, one small overshoot. */
  dropletOut: { omega: 5, zeta: 0.72 },
  /** The droplet melting back in (pointer leaves or presses). */
  dropletIn: { omega: 13, zeta: 0.7 },
  /** A lens sliding to the newly selected option. */
  slide: { omega: 14, zeta: 0.75 },
  /** A dragged lens following the finger. */
  drag: { omega: 40, zeta: 0.999 }
};
var lerp = (a, b, t) => a + (b - a) * t;
var clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
var rgbCss = (c) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
var isVisibleColor = (c) => !!c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c);
function surfaceColorOf(el) {
  for (let a = el; a; a = a.parentElement) {
    const c = getComputedStyle(a).backgroundColor;
    if (isVisibleColor(c)) return c;
  }
  return "white";
}
var DESIGN_HEIGHT = 120;
var VERTEX = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;
var FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize, uCenter, uHalf, uLightDir;
uniform float uUnit, uDevicePx, uRadius, uBevel, uBodyX, uBand, uFieldRadius;
uniform vec3 uDrop;
uniform vec4 uBlob;
uniform vec2 uBlobShape, uBlobNeck;
uniform float uRim, uCaustic, uInner, uTopRefl, uTopBase, uRimWidth, uFresnel;
uniform float uShadow, uShadowSoft, uShadowOffset;
uniform float uLightMix, uEdgeClear;
uniform vec3 uSurface, uColor, uBorder;
uniform float uBorderWidth, uBorderAlpha;
uniform sampler2D uBack, uFront;
uniform float uTextured, uRefract, uMag, uDisp, uBlurCenter, uBlurEdge, uBlurShift, uFrost, uFrostBlur, uFrostMix;
uniform float uFrostEdge, uSaturation, uBendCurve, uEdgeBand;
uniform vec2 uRadial;
uniform float uCssPx;
out vec4 outColor;

// design units -> texture uv (textures are uploaded flipped: top row at v = 1)
vec2 toUv(vec2 d) {
  vec2 q = d * uUnit;
  return clamp(vec2(q.x / uSize.x, 1.0 - q.y / uSize.y), vec2(0.0005), vec2(0.9995));
}
vec3 backdrop(vec2 st, float lod) {
  vec4 c = textureLod(uBack, st, lod);
  return c.rgb + (1.0 - c.a) * uSurface;
}
// Frosted glass: the backdrop under a gaussian blur of deviation sigma (design units),
// gathered from 32 taps on a golden-angle spiral out to 2.5 deviations. Each tap reads a
// mip about as wide as the gap between taps, so the frost stays smooth while the backdrop moves.
vec3 frosted(vec2 p, float sigma) {
  float lod = max(log2(sigma * 0.8 * uUnit) - 0.5, 0.0);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 32; i++) {
    float f = float(i) + 0.5;
    float r = sqrt(f / 32.0) * 2.5 * sigma;
    float a = f * 2.39996323;
    float w = exp(-0.5 * r * r / (sigma * sigma));
    sum += backdrop(toUv(p + r * vec2(cos(a), sin(a))), lod) * w;
    total += w;
  }
  return sum / total;
}
// The sharp bend: the backdrop at p pushed by bend, its colours split slightly.
vec3 bent(vec2 p, vec2 bend, float split, float lod) {
  return vec3(
    backdrop(toUv(p + bend * (1.0 + split)), lod).r,
    backdrop(toUv(p + bend), lod).g,
    backdrop(toUv(p + bend * (1.0 - split)), lod).b);
}
float roundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float melt(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
  return mix(a, b, h) - k * h * (1.0 - h);
}
// The glass shape: a pill body, smoothly unioned with a separating droplet.
float bodyShape(vec2 p) {
  float body = roundRect(p - vec2(uBodyX, 0.0), uHalf, uRadius);
  if (uDrop.y <= 0.0) return body;
  float d = length(p - vec2(uDrop.x, 0.0)) - uDrop.y;
  float k = max(uDrop.z, 1e-3);
  float h = clamp(0.5 + 0.5 * (d - body) / k, 0.0, 1.0);
  return mix(d, body, h) - k * h * (1.0 - h);
}
// ...and with the optional second box (uBlobShape.y = its bridge softness, 0 = none).
float blobSoft(vec2 p) {
  float k = uBlobShape.y;
  if (uBlobNeck.y > 0.0) {
    float n = (p.x - uBlobNeck.x) / uBlobNeck.y;
    // A peaked falloff: as the softness drops, the bridge thins into a thread before it breaks.
    k *= exp(0.2 - sqrt(n * n + 0.04));
  }
  return max(k, 1e-3);
}
float shape(vec2 p) {
  float s = bodyShape(p);
  if (uBlobShape.y <= 0.0) return s;
  return melt(roundRect(p - uBlob.xy, uBlob.zw, uBlobShape.x), s, blobSoft(p));
}
// The body with corners at least as round as the bend is deep (see uBand in main).
float field(vec2 p) {
  float f = roundRect(p - vec2(uBodyX, 0.0), uHalf, uFieldRadius);
  if (uBlobShape.y <= 0.0) return f;
  return melt(roundRect(p - uBlob.xy, uBlob.zw, uBlobShape.x), f, blobSoft(p));
}
// The reference darkens linear colour; on sRGB values the same factor is k^(1/2.2).
float dim(float k) { return pow(clamp(k, 0.0, 1.0), 1.0 / 2.2); }
vec3 dim(vec3 k) { return pow(clamp(k, 0.0, 1.0), vec3(1.0 / 2.2)); }
float height(vec2 p) {
  float t = pow(clamp(-shape(p) / uBevel, 0.0, 1.0), 1.0 / 1.4);
  return sqrt(1.0 - (1.0 - t) * (1.0 - t));
}
// Radial bend (the SVG card's): towards the centre, strongest at the rim, fading over the
// half size. uRadial is the full bend per axis (design units); uEdgeBand / 0.35 = bendDepth.
float radialRatio(float d) {
  return clamp(1.0 - abs(d) / (min(uHalf.x, uHalf.y) * uEdgeBand / 0.35), 0.0, 1.0);
}
vec2 radialBend(vec2 q) {
  float d = shape(q);
  vec2 c = q - vec2(uBodyX, 0.0);
  float k = pow(radialRatio(d), uBendCurve) * smoothstep(1.5 * uCssPx, -0.5 * uCssPx, d);
  return -c / max(length(c), 1e-4) * k * uRadial;
}
// Frost after the bend: every tap is bent on its own, and taps outside the glass are left
// out (the SVG filter saw nothing beyond the card), so the rim keeps its colour.
vec3 frostedRadial(vec2 q, float sigma) {
  float lod = max(log2(sigma * 0.8 * uUnit) - 0.5, 0.0);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 32; i++) {
    float f = float(i) + 0.5;
    float r = sqrt(f / 32.0) * 2.5 * sigma;
    float a = f * 2.39996323;
    vec2 t = q + r * vec2(cos(a), sin(a));
    float w = exp(-0.5 * r * r / (sigma * sigma)) * step(shape(t), 0.0);
    sum += backdrop(toUv(uCenter + t + radialBend(t)), lod) * w;
    total += w;
  }
  return total > 1e-4 ? sum / total : backdrop(toUv(uCenter + q + radialBend(q)), lod);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec2 local = px / uUnit - uCenter;
  float dist = shape(local);

  // Drop shadow: tight + ambient, kept near the glass, faded before the canvas edge.
  float vFade = smoothstep(-0.1, 0.9, local.y / uHalf.y) * 0.92 + 0.08;
  float outside = smoothstep(-4.0, 14.0, dist);
  float near = 1.0 - smoothstep(-6.0, uShadowSoft, shape(local - vec2(0.0, uShadowOffset)));
  float far = 1.0 - smoothstep(-10.0, uShadowSoft * 1.5, shape(local - vec2(0.0, uShadowOffset * 1.6)));
  float border = min(min(px.x, px.y), min(uSize.x - px.x, uSize.y - px.y));
  float sh = clamp((near + far) * uShadow * vFade * outside, 0.0, 0.85) * smoothstep(0.0, 14.0, border);
  vec4 outsideCol = vec4(0.0, 0.0, 0.0, 1.0 - dim(1.0 - sh));

  // Surface normal from the bevel height field.
  float e = 1.25;
  float h = height(local);
  vec2 grad = vec2(height(local + vec2(e, 0.0)) - h, height(local + vec2(0.0, e)) - h) / e;
  vec3 normal = normalize(vec3(-grad * 42.0, 1.0));
  float depth = clamp(1.0 - h, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, uBevel * uEdgeBand, -dist);
  vec2 dir = normalize(vec2(shape(local + vec2(e, 0.0)) - dist, shape(local + vec2(0.0, e)) - dist) + 1e-6);

  vec3 glass;
  if (uTextured > 0.5 && (uRadial.x > 0.0 || uRadial.y > 0.0)) {
    // Radial bend, then frost: the old SVG card's rim.
    float ratio = radialRatio(dist);
    float sharpLod = max(uBlurShift, 0.0);
    if (uFrostBlur > 0.0 && dist < 1.0) {
      vec3 frost = frostedRadial(local, uFrostBlur * mix(1.0, uFrostEdge, pow(ratio, 1.3)));
      glass = uFrostMix < 1.0 ? mix(bent(uCenter + local, radialBend(local), uDisp * 0.35, sharpLod), frost, uFrostMix) : frost;
    } else {
      glass = bent(uCenter + local, radialBend(local), uDisp * 0.35, sharpLod);
    }
    if (uSaturation != 1.0) glass = max(mix(vec3(dot(glass, vec3(0.2126, 0.7152, 0.0722))), glass, uSaturation), 0.0);
  } else if (uTextured > 0.5) {
    // Refraction: magnify the middle, bend inwards at the rim, split colours slightly.
    // A lens with square corners (uBand > 0) bends deeper than its corner radius. The
    // bend then follows a shape whose corners are at least that round: on the real
    // shape its direction would break along the diagonals. Mask and light keep the real shape.
    float bendEdge = edge;
    vec2 bendDir = dir;
    if (uBand > 0.0) {
      float fd = field(local);
      bendDir = normalize(vec2(field(local + vec2(e, 0.0)) - fd, field(local + vec2(0.0, e)) - fd) + 1e-6);
      bendEdge = 1.0 - smoothstep(0.0, uBand, -fd);
    }
    vec2 magnified = local / (uMag * h + 1.0);
    vec2 bend = -bendDir * uRefract * pow(bendEdge, uBendCurve);
    float split = uDisp * 0.35;
    float lod = max(mix(uBlurCenter, uBlurEdge, pow(bendEdge, 1.3)) + uBlurShift, 0.0);
    vec2 at = uCenter + magnified;
    if (uFrostBlur > 0.0 && dist < 1.0) {
      // Frosted (inside the glass only: outside, nothing of it shows). The frost hides the
      // colour split, so one bent point is enough; uFrostMix lets the sharp bend show through.
      vec3 frost = frosted(at + bend, uFrostBlur * mix(1.0, uFrostEdge, pow(bendEdge, 1.3)));
      glass = uFrostMix < 1.0 ? mix(bent(at, bend, split, lod), frost, uFrostMix) : frost;
    } else {
      glass = bent(at, bend, split, lod);
    }
    // Vibrancy: what shows through, more (or less) saturated.
    if (uSaturation != 1.0) glass = max(mix(vec3(dot(glass, vec3(0.2126, 0.7152, 0.0722))), glass, uSaturation), 0.0);
  } else {
    // Tinted glass: its own colour in the middle, thinning towards the rim.
    glass = mix(uSurface, uColor, 1.0 - edge * uEdgeClear);
  }

  // Top reflection.
  float ny = local.y / uHalf.y;
  float nx = (local.x - uBodyX) / uHalf.x;
  float top = (1.0 - smoothstep(-0.05, 0.75, ny)) * (1.0 - nx * 0.12) * uTopRefl * 0.6 + uTopBase;
  glass *= dim(1.0 - vec3(1.0, 1.0, 0.72) * top);

  // Frosted resting state: a still lens is the flat highlight colour.
  glass = mix(glass, uColor, uFrost * step(0.5, uTextured));

  // Inner shading: just inside the rim, a wide band on the left, a deep ring.
  float up = clamp(-dir.y, 0.0, 1.0);
  float right = clamp(dir.x, 0.0, 1.0);
  float left = clamp(-dir.x, 0.0, 1.0);
  float down = clamp(dir.y, 0.0, 1.0);
  float innerBand = smoothstep(uBevel * -0.19, uBevel * -0.024, dist);
  glass *= dim(1.0 - innerBand * (up + left * 0.6 + right * 0.3 + down * 0.15) * uInner * 2.2);
  float deepBand = smoothstep(uBevel * -0.73, uBevel * -0.13, dist);
  glass *= dim(1.0 - deepBand * left * uInner * 2.0);
  float hx = (dist + uBevel * 0.45) / (uBevel * 0.26);
  float ring = exp(-hx * hx);
  glass *= dim(1.0 - ring * (right * 0.9 + up * 0.5 + left * 0.4 + down * 0.3) * uInner * 1.5);

  // Rim light + fresnel; leans a little towards the cursor when there is one.
  float fresnel = pow(clamp(1.0 - normal.z, 0.0, 1.0), 6.0);
  float rimW = max(uDevicePx * 1.1, 1.0) * uRimWidth;
  float rimLine = 1.0 - smoothstep(0.0, rimW * 1.6, abs(dist + rimW * 1.8));
  float fall = exp(-(local.y / 30.0) * (local.y / 30.0));
  float studio = right * right * fall * 0.9 + down * down * 0.2 + left * left * 0.55;
  float lightCos = dot(dir, uLightDir);
  float facing = clamp(lightCos, 0.0, 1.0);
  float away = clamp(-lightCos, 0.0, 1.0);
  float lit = facing * facing * 0.9 + away * away * 0.55;
  float lean = uLightMix * 0.4;
  float rimDir = mix(studio, lit, lean);
  float front = mix(right, facing, lean);
  float back = mix(left, away, lean);
  vec3 warmCool = mix(vec3(0.82, 0.9, 1.08), vec3(1.2, 0.95, 0.78), 1.0 - smoothstep(-0.5, 0.1, nx));
  vec3 rimCol = mix(vec3(1.0), warmCool, down * 0.6);
  rimCol = mix(rimCol, vec3(0.12, 0.6, 1.2), back * 0.85);
  glass += rimCol * (rimLine * rimDir * uRim + fresnel * front * uFresnel * step(0.001, uRim));

  // Caustic: warm light gathering inside the bottom edge.
  glass += vec3(1.0, 0.92, 0.86) * smoothstep(0.72, 0.98, depth) * down * uCaustic;

  float aa = max(fwidth(dist), 1e-4);
  float mask = 1.0 - smoothstep(-aa, aa, dist);
  // Bordered body (outline buttons): a flat line just inside the edge.
  glass = mix(glass, uBorder, smoothstep(-uBorderWidth - aa, -uBorderWidth + aa, dist) * step(1e-4, uBorderWidth) * uBorderAlpha);
  vec4 col = mix(outsideCol, vec4(clamp(glass, 0.0, 1.0), 1.0), mask);
  // Front layer (selected labels) sits on the frosted pill and fades as the lens clears.
  vec4 fg = texture(uFront, gl_FragCoord.xy / uSize) * mask * uFrost * step(0.5, uTextured);
  outColor = fg + col * (1.0 - fg.a);
}
`;
function createEngine() {
  const glCanvas = document.createElement("canvas");
  const gl = glCanvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    console.warn("[liquid-glass] shader failed to compile", gl.getShaderInfoLog(s));
    return null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  const layer = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { canvas, ctx, tex };
  };
  const back = layer();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  const front = layer();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  if (!back.ctx || !front.ctx) return null;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.uniform1i(gl.getUniformLocation(program, "uBack"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uFront"), 1);
  const locations = /* @__PURE__ */ new Map();
  const u = (name) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  };
  const views = /* @__PURE__ */ new Set();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let dead = false;
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = probeCanvas.height = 1;
  const probe = probeCanvas.getContext("2d", { willReadFrequently: true });
  const colors = /* @__PURE__ */ new Map();
  const resolveColor = (css) => {
    if (!probe) return [1, 1, 1, 1];
    const known = colors.get(css);
    if (known) return known;
    const span = document.createElement("span");
    span.style.color = css;
    document.body.appendChild(span);
    const computed = getComputedStyle(span).color;
    span.remove();
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = computed;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const rgba = [r / 255, g / 255, b / 255, a / 255];
    colors.set(css, rgba);
    return rgba;
  };
  const pointer = { x: 0, y: 0, active: false, moved: false, mix: 0 };
  const draw = (v, refresh) => {
    const m = v.lens(refresh);
    if (!m || m.width < 2 || m.height < 2) {
      v.ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
      return;
    }
    const st = v.canvas.style;
    st.left = `${m.left}px`;
    st.top = `${m.top}px`;
    st.width = `${m.width}px`;
    st.height = `${m.height}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const devW = Math.max(2, Math.round(m.width * dpr));
    const devH = Math.max(2, Math.round(m.height * dpr));
    if (v.canvas.width !== devW || v.canvas.height !== devH) {
      v.canvas.width = devW;
      v.canvas.height = devH;
    }
    if (glCanvas.width < devW || glCanvas.height < devH) {
      glCanvas.width = Math.max(glCanvas.width, devW);
      glCanvas.height = Math.max(glCanvas.height, devH);
    }
    gl.viewport(0, 0, devW, devH);
    const unit = m.unit;
    const r = m.refraction;
    if (r) {
      for (const l of [back, front]) {
        if (l.canvas.width !== devW || l.canvas.height !== devH) {
          l.canvas.width = devW;
          l.canvas.height = devH;
        }
        l.ctx.setTransform(1, 0, 0, 1, 0, 0);
        l.ctx.clearRect(0, 0, devW, devH);
        l.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      r.paint(back.ctx, front.ctx);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, back.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, back.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, front.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, front.canvas);
    }
    gl.uniform1f(u("uTextured"), r ? 1 : 0);
    gl.uniform1f(u("uRefract"), r?.refract ?? 0);
    gl.uniform1f(u("uMag"), r?.magnify ?? 0);
    gl.uniform1f(u("uDisp"), r?.dispersion ?? 0);
    gl.uniform1f(u("uBlurCenter"), r?.blurCenter ?? 0);
    gl.uniform1f(u("uBlurEdge"), r?.blurEdge ?? 0);
    gl.uniform1f(u("uBlurShift"), Math.log2(Math.max(unit * dpr / 2.27, 1e-3)));
    gl.uniform1f(u("uFrost"), r?.frost ?? 0);
    gl.uniform1f(u("uFrostBlur"), Math.max(0, r?.blur ?? 0) / unit);
    gl.uniform1f(u("uFrostMix"), clamp(r?.blurMix ?? 1));
    const radial = Math.max(0, r?.radial ?? 0);
    gl.uniform2f(u("uRadial"), radial * window.innerWidth / unit, radial * window.innerHeight / unit);
    gl.uniform1f(u("uCssPx"), 1 / unit);
    gl.uniform2f(u("uSize"), devW, devH);
    gl.uniform1f(u("uUnit"), unit * dpr);
    gl.uniform1f(u("uDevicePx"), 1 / (unit * dpr));
    gl.uniform2f(u("uCenter"), m.cx / unit, m.cy / unit);
    gl.uniform2f(u("uHalf"), Math.max(m.hx / unit, 0.5), Math.max(m.hy / unit, 0.5));
    const radius = Math.max(0, Math.min(m.radius, m.hx - 0.5, m.hy - 0.5) / unit);
    gl.uniform1f(u("uRadius"), radius);
    const band = r ? m.band ?? 0 : 0;
    gl.uniform1f(u("uBand"), band);
    gl.uniform1f(u("uFieldRadius"), Math.min(Math.max(radius, band), Math.max(0, (Math.min(m.hx, m.hy) - 0.5) / unit)));
    gl.uniform1f(u("uBodyX"), m.bodyX / unit);
    gl.uniform3f(u("uDrop"), (m.droplet?.x ?? 0) / unit, (m.droplet?.r ?? 0) / unit, (m.droplet?.k ?? 0) / unit);
    const blob = m.blob;
    gl.uniform4f(u("uBlob"), (blob?.x ?? 0) / unit, (blob?.y ?? 0) / unit, (blob?.hx ?? 0) / unit, (blob?.hy ?? 0) / unit);
    gl.uniform2f(u("uBlobShape"), (blob?.r ?? 0) / unit, (blob?.k ?? 0) / unit);
    gl.uniform2f(u("uBlobNeck"), (blob?.neck?.x ?? 0) / unit, (blob?.neck?.w ?? 0) / unit);
    gl.uniform1f(u("uBevel"), Math.max(m.bevel, 2));
    const k = m.tune ?? {};
    gl.uniform1f(u("uRim"), 0.55 * m.strength * (k.rim ?? 1));
    gl.uniform1f(u("uCaustic"), 0.08 * m.strength * (k.caustic ?? 1));
    gl.uniform1f(u("uInner"), 0.1 * m.strength * (k.inner ?? 1));
    gl.uniform1f(u("uTopRefl"), 0.3 * m.strength * (k.reflection ?? 1));
    gl.uniform1f(u("uTopBase"), 0.02 * m.strength * (k.reflection ?? 1));
    gl.uniform1f(u("uRimWidth"), Math.max(0.05, k.rimWidth ?? 1));
    gl.uniform1f(u("uFresnel"), 0.02 * (k.fresnel ?? 1));
    gl.uniform1f(u("uBendCurve"), Math.max(0.05, k.bendCurve ?? 1.6));
    gl.uniform1f(u("uEdgeBand"), 0.35 * Math.max(0.05, k.bendDepth ?? 1));
    gl.uniform1f(u("uSaturation"), Math.max(0, k.saturation ?? 1));
    gl.uniform1f(u("uFrostEdge"), Math.max(0.05, k.frostEdge ?? 1));
    gl.uniform1f(u("uShadow"), m.shadow * m.strength);
    gl.uniform1f(u("uShadowSoft"), m.shadowSoftness);
    gl.uniform1f(u("uShadowOffset"), m.shadowOffset);
    gl.uniform3f(u("uSurface"), ...m.surface);
    gl.uniform3f(u("uColor"), ...m.color);
    gl.uniform1f(u("uEdgeClear"), m.edgeClear);
    gl.uniform3f(u("uBorder"), ...m.border ?? m.color);
    gl.uniform1f(u("uBorderWidth"), m.border ? Math.max(0, m.borderWidth ?? 1) / unit : 0);
    gl.uniform1f(u("uBorderAlpha"), clamp(m.borderAlpha ?? 1));
    const dx = pointer.x - m.screenX;
    const dy = pointer.y - m.screenY;
    const d = Math.hypot(dx, dy);
    gl.uniform2f(u("uLightDir"), d > 0.5 ? dx / d : 0, d > 0.5 ? dy / d : -1);
    gl.uniform1f(u("uLightMix"), m.cursorLight ? pointer.mix : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    v.ctx.clearRect(0, 0, devW, devH);
    v.ctx.drawImage(glCanvas, 0, glCanvas.height - devH, devW, devH, 0, 0, devW, devH);
    v.drawn?.();
  };
  let raf2 = 0;
  let last2 = 0;
  const frame = (now) => {
    raf2 = 0;
    if (dead) return;
    const dt = last2 ? Math.min((now - last2) / 1e3, 1 / 30) : 1 / 60;
    last2 = now;
    const still = reduced.matches;
    const target = pointer.active && !still ? 1 : 0;
    const before = pointer.mix;
    pointer.mix += (target - pointer.mix) * Math.min(1, dt * 6);
    if (Math.abs(pointer.mix - target) < 2e-3) pointer.mix = target;
    const relight = pointer.moved || pointer.mix !== before;
    pointer.moved = false;
    let running2 = pointer.mix !== target;
    for (const v of views) {
      const moving = v.step(dt, still);
      if (moving) running2 = true;
      if (!v.visible) continue;
      if (moving || v.dirty || relight) {
        const refresh = v.dirty;
        v.dirty = false;
        draw(v, refresh);
      }
    }
    if (running2 && !raf2) raf2 = requestAnimationFrame(frame);
    else if (!running2 && !raf2) last2 = 0;
  };
  const wake = () => {
    if (!raf2 && !dead) raf2 = requestAnimationFrame(frame);
  };
  const invalidateAll = () => {
    colors.clear();
    for (const v of views) v.dirty = true;
    wake();
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      pointer.moved = true;
      wake();
    },
    { passive: true }
  );
  document.documentElement.addEventListener("pointerleave", () => {
    pointer.active = false;
    pointer.moved = true;
    wake();
  });
  new MutationObserver(invalidateAll).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"]
  });
  new MutationObserver(invalidateAll).observe(document.body, { attributes: true, attributeFilter: ["data-theme"], subtree: true });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", invalidateAll);
  window.addEventListener("resize", invalidateAll, { passive: true });
  glCanvas.addEventListener("webglcontextlost", () => {
    dead = true;
    for (const v of views) {
      v.lost();
      v.ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
    }
    engine = void 0;
  });
  return {
    add: (v) => {
      views.add(v);
      wake();
    },
    remove: (v) => views.delete(v),
    wake,
    resolveColor
  };
}
var engine;
function getGlassEngine() {
  if (typeof window === "undefined") return null;
  if (engine === void 0) engine = createEngine();
  return engine;
}

// src/dom-snapshot.ts
var isVisibleColor2 = (color) => !!color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color) && !/\/\s*0\)$/.test(color);
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}
var lengthOf = (token, span) => token.endsWith("%") ? span * parseFloat(token) / 100 : parseFloat(token) || 0;
function along(token, free) {
  if (!token) return free / 2;
  const calc = /^calc\(([-\d.]+)% ([+-]) ([\d.]+)px\)$/.exec(token);
  if (calc) return free * Number(calc[1]) / 100 + (calc[2] === "-" ? -1 : 1) * Number(calc[3]);
  if (/^-?[\d.]/.test(token)) return lengthOf(token, free);
  return token === "left" || token === "top" ? 0 : token === "right" || token === "bottom" ? free : free / 2;
}
function placeOf(position, freeX, freeY) {
  let [a, b, c, d] = splitTop(position, " ");
  if (d) return [a === "right" ? freeX - along(b, freeX) : along(b, freeX), c === "bottom" ? freeY - along(d, freeY) : along(d, freeY)];
  if (a === "top" || a === "bottom" || b === "left" || b === "right") [a, b] = [b, a];
  return [along(a, freeX), along(b, freeY)];
}
var verdicts = /* @__PURE__ */ new WeakMap();
function isClean(source, key = "") {
  const known = verdicts.get(source);
  if (known && known.key === key) return known.ok;
  let ok = false;
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(source, 0, 0, 1, 1);
      ctx.getImageData(0, 0, 1, 1);
      ok = true;
    }
  } catch {
  }
  verdicts.set(source, { key, ok });
  return ok;
}
var waiting = /* @__PURE__ */ new WeakMap();
function isLoaded(image, onStale) {
  if (image.complete) return image.naturalWidth > 0;
  if (!onStale) return false;
  let callbacks = waiting.get(image);
  if (!callbacks) {
    const pending = callbacks = /* @__PURE__ */ new Set();
    waiting.set(image, pending);
    image.addEventListener(
      "load",
      () => {
        waiting.delete(image);
        pending.forEach((notify) => notify());
      },
      { once: true }
    );
  }
  callbacks.add(onStale);
  return false;
}
var isSameOrigin = (src) => {
  try {
    const url = new URL(src, location.href);
    return url.protocol === "data:" || url.protocol === "blob:" || url.origin === location.origin;
  } catch {
    return false;
  }
};
var copies = /* @__PURE__ */ new Map();
function imageCopy(src) {
  let image = copies.get(src);
  if (!image) {
    if (copies.size > 200) copies.clear();
    image = new Image();
    if (!isSameOrigin(src)) image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = src;
    copies.set(src, image);
  }
  return image;
}
function drawFitted(ctx, source, sw, sh, box, radius, style) {
  const fit = style.objectFit;
  let w = box.w;
  let h = box.h;
  if (fit !== "fill") {
    const contain = Math.min(box.w / sw, box.h / sh);
    const k = fit === "cover" ? Math.max(box.w / sw, box.h / sh) : fit === "none" ? 1 : fit === "scale-down" ? Math.min(1, contain) : contain;
    w = sw * k;
    h = sh * k;
  }
  const [ox, oy] = placeOf(style.objectPosition, box.w - w, box.h - h);
  const clips = radius > 0 || w > box.w + 0.5 || h > box.h + 0.5;
  if (clips) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, radius);
    ctx.clip();
  }
  ctx.drawImage(source, box.x + ox, box.y + oy, w, h);
  if (clips) ctx.restore();
}
var svgCache = /* @__PURE__ */ new WeakMap();
var svgTaints = false;
function drawSvg(ctx, svg, color, box, onStale, cacheKey) {
  if (svgTaints) return;
  const key = `${color}|${cacheKey}|${Math.round(box.w)}x${Math.round(box.h)}`;
  let entry = svgCache.get(svg);
  if (!entry || entry.key !== key) {
    const clone = svg.cloneNode(true);
    const originals = [svg, ...svg.querySelectorAll("*")];
    const clones = [clone, ...clone.querySelectorAll("*")];
    originals.forEach((original, i) => {
      const style = getComputedStyle(original);
      const target = clones[i];
      target.removeAttribute("class");
      target.style.fill = style.fill;
      target.style.stroke = style.stroke;
      target.style.animation = "none";
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(box.w));
    clone.setAttribute("height", String(box.h));
    clone.style.color = color;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    entry = { key, image };
    svgCache.set(svg, entry);
  }
  if (!isLoaded(entry.image, onStale)) return;
  if (isClean(entry.image)) ctx.drawImage(entry.image, box.x, box.y, box.w, box.h);
  else svgTaints = true;
}
function parseStops(args, currentColor) {
  const stops = [];
  for (const arg of args) {
    const tokens = splitTop(arg, " ");
    const positions = [];
    while (tokens.length && /^-?[\d.]+(%|px)$/.test(tokens[tokens.length - 1])) positions.unshift(tokens.pop());
    if (!tokens.length) continue;
    const color = tokens.join(" ").replace(/currentcolor/gi, currentColor);
    if (!positions.length) stops.push({ color, at: null, px: false });
    for (const position of positions) stops.push({ color, at: parseFloat(position), px: position.endsWith("px") });
  }
  return stops.length > 1 ? stops : null;
}
function parseImage(text, currentColor) {
  const url = /^url\((['"]?)(.*)\1\)$/.exec(text);
  if (url) return { kind: "url", src: url[2] };
  const gradient = /^(repeating-)?(linear|radial)-gradient\(([\s\S]*)\)$/.exec(text);
  if (!gradient) return null;
  const repeating = !!gradient[1];
  const args = splitTop(gradient[3], ",");
  const first = args[0] ?? "";
  const head = first.replace(/\bin\s+[\w-]+(\s+\w+\s+hue)?/i, "").trim();
  const spaceOnly = head === "" && first !== "";
  if (gradient[2] === "linear") {
    let angle = Math.PI;
    let corner = "";
    let isDirection = spaceOnly;
    if (/^to\s/.test(head)) {
      const v = /top/.test(head) ? "t" : /bottom/.test(head) ? "b" : "";
      const hz = /left/.test(head) ? "l" : /right/.test(head) ? "r" : "";
      if (v && hz) corner = v + hz;
      else angle = { t: 0, r: Math.PI / 2, b: Math.PI, l: Math.PI * 1.5 }[v || hz] ?? Math.PI;
      isDirection = true;
    } else if (/^-?[\d.]+(deg|grad|rad|turn)$/.test(head)) {
      const n = parseFloat(head);
      angle = head.endsWith("turn") ? n * Math.PI * 2 : head.endsWith("grad") ? n * Math.PI / 200 : head.endsWith("rad") ? n : n * Math.PI / 180;
      isDirection = true;
    }
    const stops2 = parseStops(isDirection ? args.slice(1) : args, currentColor);
    return stops2 && { kind: "linear", repeating, stops: stops2, angle, corner };
  }
  const isShape = spaceOnly || /^(circle|ellipse|closest-|farthest-|at\s|-?[\d.]+(px|%))/.test(head);
  const [shape = "", at = "center"] = isShape ? head.split(/\s*\bat\s+/) : [];
  const size = shape.match(/-?[\d.]+(px|%)/g) ?? [];
  const stops = parseStops(isShape ? args.slice(1) : args, currentColor);
  return stops && {
    kind: "radial",
    repeating,
    stops,
    circle: /circle/.test(shape) || size.length === 1,
    extent: /(closest|farthest)-(side|corner)/.exec(shape)?.[0] ?? "farthest-corner",
    size,
    at
  };
}
var parsed = /* @__PURE__ */ new Map();
function imagesOf(style) {
  const value = style.backgroundImage;
  const key = /currentcolor/i.test(value) ? `${value}|${style.color}` : value;
  let images = parsed.get(key);
  if (!images) {
    if (parsed.size > 300) parsed.clear();
    images = splitTop(value, ",").map((image) => parseImage(image, style.color));
    parsed.set(key, images);
  }
  return images;
}
function clearOf(color) {
  const legacy = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color);
  if (legacy) return `rgba(${legacy[1]}, ${legacy[2]}, ${legacy[3]}, 0)`;
  const modern = /^([a-z-]+\([^/)]+?)\s*(\/[^)]*)?\)$/.exec(color);
  return modern ? `${modern[1]} / 0)` : color;
}
function rampOf(stops, length, repeating, reach = 1) {
  const at = stops.map((stop) => stop.at === null ? null : stop.px ? stop.at / Math.max(length, 1e-6) : stop.at / 100);
  if (at[0] === null) at[0] = 0;
  if (at[at.length - 1] === null) at[at.length - 1] = 1;
  for (let i = 1; i < at.length; i++) {
    if (at[i] === null) {
      let j = i;
      while (at[j] === null) j++;
      const a = at[i - 1];
      const b = Math.max(at[j], a);
      for (let k = i; k < j; k++) at[k] = a + (b - a) * (k - i + 1) / (j - i + 1);
    }
    at[i] = Math.max(at[i], at[i - 1]);
  }
  let list = [];
  stops.forEach((stop, i) => {
    const p = at[i];
    const before = stops[i - 1];
    const after = stops[i + 1];
    const fades = !isVisibleColor2(stop.color);
    const fromBefore = fades && !!before && isVisibleColor2(before.color);
    const toAfter = fades && !!after && isVisibleColor2(after.color);
    if (fromBefore) list.push([p, clearOf(before.color)]);
    if (toAfter) list.push([p, clearOf(after.color)]);
    if (!fromBefore && !toAfter) list.push([p, stop.color]);
  });
  let from = list[0][0];
  let to = list[list.length - 1][0];
  const period = to - from;
  if (repeating && period > 1e-4) {
    const first = Math.floor(-from / period);
    const count = Math.ceil((reach - from) / period) - first;
    if (count > 200) return null;
    const one = list;
    list = [];
    for (let k = first; k < first + count; k++) for (const [p, color] of one) list.push([p + k * period, color]);
    from += first * period;
    to = from + count * period;
  }
  const span = Math.max(to - from, 0.02 / Math.max(length, 1e-6));
  return { from, to: from + span, stops: list.map(([p, color]) => [Math.min(1, Math.max(0, (p - from) / span)), color]) };
}
function fillGradient(ctx, gradient, w, h) {
  if (gradient.kind === "linear") {
    let angle = gradient.angle;
    if (gradient.corner) {
      const base = Math.atan2(h, w);
      angle = { tr: base, br: Math.PI - base, bl: Math.PI + base, tl: -base }[gradient.corner] ?? base;
    }
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const length = Math.abs(w * sin) + Math.abs(h * cos);
    const ramp2 = rampOf(gradient.stops, length, gradient.repeating);
    if (!ramp2) return;
    const x = (t) => w / 2 + sin * length * (t - 0.5);
    const y = (t) => h / 2 - cos * length * (t - 0.5);
    const fill2 = ctx.createLinearGradient(x(ramp2.from), y(ramp2.from), x(ramp2.to), y(ramp2.to));
    for (const [p, color] of ramp2.stops) fill2.addColorStop(p, color);
    ctx.fillStyle = fill2;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const [cx, cy] = placeOf(gradient.at, w, h);
  const dx = [Math.abs(cx), Math.abs(w - cx)];
  const dy = [Math.abs(cy), Math.abs(h - cy)];
  const pick = gradient.extent.startsWith("closest") ? Math.min : Math.max;
  let rx = pick(...dx);
  let ry = pick(...dy);
  if (gradient.size.length) {
    rx = lengthOf(gradient.size[0], w);
    ry = gradient.size[1] ? lengthOf(gradient.size[1], h) : rx;
  } else if (gradient.circle) rx = ry = gradient.extent.endsWith("corner") ? Math.hypot(rx, ry) : pick(rx, ry);
  else if (gradient.extent.endsWith("corner")) {
    rx *= Math.SQRT2;
    ry *= Math.SQRT2;
  }
  if (rx < 0.01 || ry < 0.01) return;
  const ramp = rampOf(gradient.stops, rx, gradient.repeating, Math.hypot(Math.max(...dx) / rx, Math.max(...dy) / ry));
  if (!ramp) return;
  const inner = Math.max(0, rx * ramp.from);
  const fill = ctx.createRadialGradient(0, 0, inner, 0, 0, Math.max(rx * ramp.to, inner + 1e-3));
  for (const [p, color] of ramp.stops) fill.addColorStop(p, color);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = fill;
  ctx.fillRect(-cx, -cy * rx / ry, w, h * rx / ry);
  ctx.restore();
}
function paintBackgrounds(ctx, style, area, bounds, onStale) {
  const images = imagesOf(style);
  const sizes = splitTop(style.backgroundSize, ",");
  const positions = splitTop(style.backgroundPosition, ",");
  const repeats = splitTop(style.backgroundRepeat, ",");
  for (let n = images.length - 1; n >= 0; n--) {
    const image = images[n];
    if (!image) continue;
    let source = null;
    let tw = area.w;
    let th = area.h;
    if (image.kind === "url") {
      source = imageCopy(image.src);
      if (!isLoaded(source, onStale) || !isClean(source)) continue;
      tw = source.naturalWidth;
      th = source.naturalHeight;
    }
    const size = sizes[n % sizes.length] ?? "auto";
    if (size === "cover" || size === "contain") {
      const k = (size === "cover" ? Math.max : Math.min)(area.w / tw, area.h / th);
      tw *= k;
      th *= k;
    } else {
      const [sw = "auto", sh = "auto"] = splitTop(size, " ");
      const ratio = tw / th;
      if (sw !== "auto") tw = lengthOf(sw, area.w);
      if (sh !== "auto") th = lengthOf(sh, area.h);
      if (source && sw !== "auto" && sh === "auto") th = tw / ratio;
      if (source && sw === "auto" && sh !== "auto") tw = th * ratio;
    }
    if (!(tw >= 0.5 && th >= 0.5)) continue;
    const [ox, oy] = placeOf(positions[n % positions.length] ?? "0% 0%", area.w - tw, area.h - th);
    const repeat = repeats[n % repeats.length] ?? "repeat";
    const [repeatX, repeatY = repeatX] = repeat.split(" ");
    const tilesX = repeat !== "repeat-y" && repeatX !== "no-repeat";
    const tilesY = repeat !== "repeat-x" && repeatY !== "no-repeat";
    const x0 = area.x + ox;
    const y0 = area.y + oy;
    const i0 = tilesX ? Math.floor((bounds.x - x0) / tw) : 0;
    const i1 = tilesX ? Math.floor((bounds.x + bounds.w - x0 - 0.01) / tw) : 0;
    const j0 = tilesY ? Math.floor((bounds.y - y0) / th) : 0;
    const j1 = tilesY ? Math.floor((bounds.y + bounds.h - y0 - 0.01) / th) : 0;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
    try {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          ctx.save();
          ctx.translate(x0 + i * tw, y0 + j * th);
          if (source) ctx.drawImage(source, 0, 0, tw, th);
          else fillGradient(ctx, image, tw, th);
          ctx.restore();
        }
      }
    } catch {
      ctx.restore();
    }
  }
}
function drawText(ctx, node, style, originX, originY, lang, isVisible) {
  const raw = node.textContent ?? "";
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const lines = [...range.getClientRects()].filter((rect) => rect.width > 0.5);
  if (!lines.length) return;
  const transform = style.textTransform;
  if (transform === "uppercase") text = text.toLocaleUpperCase(lang);
  else if (transform === "lowercase") text = text.toLocaleLowerCase(lang);
  else if (transform === "capitalize") text = text.replace(/(^|\s)(\S)/g, (_, gap, letter) => gap + letter.toUpperCase());
  const rtl = style.direction === "rtl";
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = "left";
  ctx.fillStyle = style.color;
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText("Hg\u0130\u015F");
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  const space = ctx.measureText(" ").width;
  const words = text.split(" ");
  let next = 0;
  lines.forEach((rect, i) => {
    let line = "";
    if (i === lines.length - 1) line = words.slice(next).join(" ");
    else {
      while (next < words.length) {
        const candidate = line ? `${line} ${words[next]}` : words[next];
        if (line && ctx.measureText(candidate).width > rect.width + 1) break;
        line = candidate;
        next++;
      }
    }
    if (!line || !isVisible(rect)) return;
    const lead = i === 0 && !rtl && /^\s/.test(raw) && rect.width - ctx.measureText(line).width > space * 0.5 ? space : 0;
    const baseline = rect.top - originY + (rect.height - (ascent + descent)) / 2 + ascent;
    ctx.fillText(line, rect.left - originX + lead, baseline);
  });
}
var scratch;
function blurBackdrop(ctx, box, radius, blurPx) {
  const matrix = ctx.getTransform();
  const scale = matrix.a;
  const left = Math.max(0, Math.floor(box.x * scale + matrix.e));
  const top = Math.max(0, Math.floor(box.y * scale + matrix.f));
  const w = Math.min(ctx.canvas.width, Math.ceil((box.x + box.w) * scale + matrix.e)) - left;
  const h = Math.min(ctx.canvas.height, Math.ceil((box.y + box.h) * scale + matrix.f)) - top;
  if (w < 1 || h < 1) return;
  const pad = Math.ceil(blurPx * scale * 3);
  scratch ??= document.createElement("canvas");
  scratch.width = w + 2 * pad;
  scratch.height = h + 2 * pad;
  const copy = scratch.getContext("2d");
  if (!copy) return;
  copy.imageSmoothingEnabled = false;
  copy.drawImage(ctx.canvas, left, top, w, h, pad, pad, w, h);
  copy.drawImage(scratch, pad, pad, 1, h, 0, pad, pad, h);
  copy.drawImage(scratch, pad + w - 1, pad, 1, h, pad + w, pad, pad, h);
  copy.drawImage(scratch, 0, pad, w + 2 * pad, 1, 0, 0, w + 2 * pad, pad);
  copy.drawImage(scratch, 0, pad + h - 1, w + 2 * pad, 1, 0, pad + h, w + 2 * pad, pad);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, radius);
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(left, top, w, h);
  ctx.filter = `blur(${blurPx * scale}px)`;
  ctx.drawImage(scratch, left - pad, top - pad);
  ctx.restore();
}
function layerOf(style, inFlexOrGrid) {
  const positioned = style.position !== "static";
  const z = (positioned || inFlexOrGrid) && style.zIndex !== "auto" ? parseInt(style.zIndex, 10) || 0 : 0;
  if (z) return [z < 0 ? 0 : 3, z];
  const stacks = positioned || style.opacity !== "1" || style.transform !== "none" || style.filter !== "none" || style.isolation === "isolate" || (style.backdropFilter || "none") !== "none";
  return [stacks ? 2 : 1, 0];
}
function clipShape(value, box) {
  if (!value || value === "none") return null;
  const path = /^path\((?:[a-z-]+\s*,\s*)?["'](.*)["']\)$/s.exec(value);
  if (path) {
    const shape2 = new Path2D();
    shape2.addPath(new Path2D(path[1]), new DOMMatrix().translate(box.x, box.y));
    return shape2;
  }
  const inset = /^inset\((.*)\)$/s.exec(value);
  if (!inset) return null;
  const [sides, round = ""] = inset[1].split(/\s+round\s+/);
  const length = (token, of) => token.endsWith("%") ? parseFloat(token) / 100 * of : parseFloat(token) || 0;
  const t = sides.trim().split(/\s+/);
  const top = length(t[0], box.h);
  const right = length(t[1] ?? t[0], box.w);
  const bottom = length(t[2] ?? t[0], box.h);
  const left = length(t[3] ?? t[1] ?? t[0], box.w);
  const w = Math.max(0, box.w - left - right);
  const h = Math.max(0, box.h - top - bottom);
  const shape = new Path2D();
  shape.roundRect(box.x + left, box.y + top, w, h, Math.min(round ? length(round.trim().split(/\s+/)[0], Math.min(w, h)) : 0, w / 2, h / 2));
  return shape;
}
function drawDom(ctx, root, options) {
  const { origin, region, skip, onStale, cacheKey = document.documentElement.className } = options;
  const originX = origin.left;
  const originY = origin.top;
  const deferred = [];
  const intersects = (rect) => !region || rect.right > region.left && rect.left < region.right && rect.bottom > region.top && rect.top < region.bottom;
  let lang;
  try {
    lang = Intl.getCanonicalLocales(document.documentElement.lang)[0];
  } catch {
  }
  const walk = (element, parentOpacity, isDeferred = false, style = getComputedStyle(element)) => {
    if (skip?.(element)) return;
    if (style.display === "none" || style.visibility === "hidden") return;
    const opacity = parentOpacity * Number(style.opacity);
    if (opacity < 0.01) return;
    if (!isDeferred && element !== root && (style.position === "fixed" || style.position === "sticky")) {
      deferred.push({ element, opacity: parentOpacity });
      return;
    }
    const drawChildren = () => {
      const inFlexOrGrid = /flex|grid/.test(style.display);
      const children = [...element.childNodes].map((node) => {
        const childStyle = node instanceof Element ? getComputedStyle(node) : null;
        const [layer, z] = childStyle ? layerOf(childStyle, inFlexOrGrid) : [1, 0];
        return { node, childStyle, layer, z };
      });
      children.sort((a, b) => a.layer - b.layer || a.z - b.z);
      for (const { node, childStyle } of children) {
        if (childStyle) walk(node, opacity, false, childStyle);
        else if (node.nodeType === Node.TEXT_NODE) {
          ctx.globalAlpha = opacity;
          drawText(ctx, node, style, originX, originY, lang, intersects);
        }
      }
    };
    if (style.display === "contents") {
      drawChildren();
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.width <= 1 && rect.height <= 1 || !intersects(rect)) return;
    const box = { x: rect.left - originX, y: rect.top - originY, w: rect.width, h: rect.height };
    const shape = clipShape(style.clipPath, box);
    if (shape) {
      ctx.save();
      ctx.clip(shape);
    }
    try {
      paintBox(element, style, rect, box, opacity, drawChildren);
    } finally {
      if (shape) ctx.restore();
    }
  };
  const paintBox = (element, style, rect, box, opacity, drawChildren) => {
    const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2);
    const backdropBlur = /blur\(([\d.]+)px\)/.exec(style.backdropFilter);
    if (backdropBlur) blurBackdrop(ctx, box, radius, Number(backdropBlur[1]));
    ctx.globalAlpha = opacity;
    const hasBox = style.backgroundClip !== "text";
    if (hasBox && isVisibleColor2(style.backgroundColor)) {
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, radius);
      ctx.fillStyle = style.backgroundColor;
      ctx.fill();
    }
    if (hasBox && style.backgroundImage !== "none") {
      const bounds = { ...box };
      if (region) {
        bounds.x = Math.max(box.x, region.left - originX);
        bounds.y = Math.max(box.y, region.top - originY);
        bounds.w = Math.min(box.x + box.w, region.right - originX) - bounds.x;
        bounds.h = Math.min(box.y + box.h, region.bottom - originY) - bounds.y;
      }
      const area = style.backgroundAttachment.includes("fixed") ? { x: -originX, y: -originY, w: innerWidth, h: innerHeight } : box;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, radius);
      ctx.clip();
      paintBackgrounds(ctx, style, area, bounds, onStale);
      ctx.restore();
    }
    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    if (borderWidth > 0 && style.borderTopStyle !== "none" && isVisibleColor2(style.borderTopColor)) {
      ctx.beginPath();
      ctx.roundRect(box.x + borderWidth / 2, box.y + borderWidth / 2, box.w - borderWidth, box.h - borderWidth, Math.max(0, radius - borderWidth / 2));
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = style.borderTopColor;
      ctx.setLineDash(style.borderTopStyle === "dashed" ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (element instanceof SVGSVGElement) {
      drawSvg(ctx, element, style.color, box, onStale, cacheKey);
      return;
    }
    if (element instanceof HTMLCanvasElement) {
      if (element.width && element.height && isClean(element)) ctx.drawImage(element, box.x, box.y, box.w, box.h);
      return;
    }
    if (element instanceof HTMLImageElement) {
      const src = element.currentSrc || element.src;
      if (!src) return;
      const image = element.complete && element.naturalWidth && isClean(element, src) ? element : imageCopy(src);
      if (isLoaded(image, onStale) && isClean(image, src)) drawFitted(ctx, image, image.naturalWidth, image.naturalHeight, box, radius, style);
      return;
    }
    if (element instanceof HTMLVideoElement) {
      if (element.readyState >= 2 && element.videoWidth && isClean(element, element.currentSrc)) drawFitted(ctx, element, element.videoWidth, element.videoHeight, box, radius, style);
      return;
    }
    const clips = element !== root && style.overflow !== "visible" && element !== document.body && element !== document.documentElement;
    if (clips) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, radius);
      ctx.clip();
    }
    drawChildren();
    if (clips) ctx.restore();
  };
  walk(root, 1);
  for (let i = 0; i < deferred.length; i++) walk(deferred[i].element, deferred[i].opacity, true);
  ctx.globalAlpha = 1;
}

// src/surface.ts
var GLASS = typeof matchMedia !== "undefined" && !matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)").matches;
var lastScroll = 0;
var readFrame = null;
if (typeof window !== "undefined") addEventListener("scroll", () => {
  lastScroll = performance.now();
}, { passive: true, capture: true });
var overCssBackdrop = (el) => {
  const r = el.getBoundingClientRect();
  for (const c of document.querySelectorAll('[data-glass-backdrop="css"]')) {
    const b = c.getBoundingClientRect();
    if (b.width && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) return true;
  }
  return false;
};
var LABELS = "a, button, label, p, h1, h2, h3, h4, h5, h6, [data-glass-label]";
var CHOSEN = '[aria-pressed="true"], [aria-current]:not([aria-current="false"])';
var PW = 48;
var PH = 16;
var probeCtx;
var getProbe = () => {
  if (probeCtx === void 0) {
    const c = document.createElement("canvas");
    c.width = PW;
    c.height = PH;
    probeCtx = c.getContext("2d", { willReadFrequently: true });
  }
  return probeCtx;
};
var linear = (v) => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
var shade = new Float32Array(PW * PH);
function readShade(src, x, y, w, h, t, g) {
  const probe = getProbe();
  if (!probe || w < 1 || h < 1) return false;
  try {
    probe.drawImage(src, x, y, w, h, 0, 0, PW, PH);
    const d = probe.getImageData(0, 0, PW, PH).data;
    for (let i = 0; i < shade.length; i++) shade[i] = 0.2126 * linear(d[i * 4] * (1 - t) + g[0] * 255 * t) + 0.7152 * linear(d[i * 4 + 1] * (1 - t) + g[1] * 255 * t) + 0.0722 * linear(d[i * 4 + 2] * (1 - t) + g[2] * 255 * t);
    return true;
  } catch {
    return false;
  }
}
function shadeIn(l, t, r, b) {
  const x0 = clamp(Math.floor(l * PW), 0, PW - 1), x1 = clamp(Math.ceil(r * PW), x0 + 1, PW), y0 = clamp(Math.floor(t * PH), 0, PH - 1), y1 = clamp(Math.ceil(b * PH), y0 + 1, PH);
  const v = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(shade[y * PW + x]);
  return v.sort((a, b2) => a - b2)[Math.floor(v.length * 0.7)];
}
var showing = (el) => el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : el.getClientRects().length > 0;
var floats = (el) => {
  for (; el; el = el.parentElement) if (/fixed|sticky/.test(getComputedStyle(el).position)) return true;
  return false;
};
function surface(host, o = {}) {
  if (o.frosted) {
    host.setAttribute("data-glass-host", "");
    return () => host.removeAttribute("data-glass-host");
  }
  const engine3 = getGlassEngine();
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!engine3 || !ctx) return null;
  const hs = getComputedStyle(host), over = hs.overflowX + hs.overflowY;
  const scrolls = /auto|scroll/.test(over), flat = scrolls || /hidden|clip/.test(over);
  canvas.className = scrolls ? "gc-canvas gc-stick" : "gc-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.setAttribute("data-glass-host", "");
  if (flat) host.setAttribute("data-glass-clip", "");
  if (scrolls) host.prepend(canvas);
  else host.append(canvas);
  let scrolled = false, w = 0, h = 0, corner = null, tint = 0, blur = 0, labels = [host], padY = 0, padL = 0, moves = false, ready = false, pressed = false, hovered = false;
  let surfaceRgb = [1, 1, 1], color = [1, 1, 1];
  const page = { canvas: document.createElement("canvas"), ctx: null, key: "", at: 0, stale: true, timer: 0 };
  const press = { x: 0, v: 0 }, growX = { x: 0, v: 0 }, growY = { x: 0, v: 0 };
  const unready = () => {
    if (ready) {
      ready = false;
      delete host.dataset.glassReady;
    }
  };
  const ink = (dark) => {
    for (const el of labels) {
      const next = !(el !== host && el.matches(CHOSEN)) && dark(el);
      if (next !== el.hasAttribute("data-glass-light")) {
        el.toggleAttribute("data-glass-light", next);
        if (el === host) view.dirty = true;
      }
    }
  };
  const read = () => {
    w = host.offsetWidth;
    h = host.offsetHeight;
    const st = getComputedStyle(host), rd = st.borderTopLeftRadius;
    if (scrolls) {
      const t = padY = parseFloat(st.paddingTop) || 0, flex = /flex|grid/.test(st.display);
      padL = parseFloat(st.paddingLeft) || 0;
      const gapX = flex ? parseFloat(st.columnGap) || 0 : 0, gapY = flex ? parseFloat(st.rowGap) || 0 : 0;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.style.flex = "none";
      canvas.style.margin = `${-t}px ${padL - w - gapX}px ${t - h - gapY}px ${-padL}px`;
    }
    const px = rd.endsWith("%") ? Math.min(w, h) * parseFloat(rd) / 100 : parseFloat(rd) || 0;
    corner = px >= Math.min(w, h) / 2 - 0.5 ? null : px;
    moves = floats(host);
    const own = [...host.querySelectorAll(LABELS)].filter((e) => {
      if (e.closest("[data-glass-host]") !== host) return false;
      const outer = e.parentElement?.closest(LABELS);
      return !outer || outer === host || !host.contains(outer);
    });
    labels = own.length ? own : [host];
    const s = engine3.resolveColor(surfaceColorOf(host.parentElement));
    surfaceRgb = [s[0], s[1], s[2]];
    const c = engine3.resolveColor(st.getPropertyValue("--gc-tint").trim() || "white");
    color = [c[0], c[1], c[2]];
    tint = clamp((parseFloat(st.getPropertyValue("--gc-tint-amount")) || 0) / 100);
    blur = parseFloat(st.getPropertyValue("--gc-blur")) || 0;
  };
  const view = {
    canvas,
    ctx,
    dirty: true,
    visible: false,
    step: (dt, still) => {
      const moved = scrolled;
      scrolled = false;
      if (still) {
        press.x = growX.x = growY.x = press.v = growX.v = growY.v = 0;
        return moved;
      }
      const hov = hovered ? 1 : 0;
      const a = stepSpring(press, pressed ? 1 : 0, SPRINGS.press, dt);
      const b = stepSpring(growX, hov, SPRINGS.hoverX, dt);
      const c = stepSpring(growY, hov, SPRINGS.hoverY, dt);
      return a || b || c || moved || view.visible && !!o.live?.();
    },
    lens: (refresh) => {
      if (refresh) {
        read();
        page.stale = true;
      }
      if (overCssBackdrop(host)) {
        unready();
        return null;
      }
      if (!showing(host)) return null;
      if (w < 2 || h < 2) return null;
      if (!ready && !moves && performance.now() - lastScroll < 160) {
        if (!page.timer) page.timer = window.setTimeout(() => {
          page.timer = 0;
          view.dirty = true;
          engine3.wake();
        }, 170);
        return null;
      }
      const padX = flat ? 0 : 8, padTop = flat ? 0 : 10, padBottom = flat ? 0 : Math.round(h * 0.8 + 4);
      const p = clamp(press.x, -0.12, 1.15), pc = clamp(press.x), unit = h / DESIGN_HEIGHT;
      const grow = flat ? 0 : h * 0.08;
      const hy = h / 2 + grow * growY.x * (1 + p * 0.1);
      const bevel = lerp(DESIGN_HEIGHT * 0.42, 62, pc);
      const radius = corner === null ? 999 : corner * (hy / (h / 2));
      const rect = host.getBoundingClientRect();
      return {
        left: (scrolls ? -padL : -padX) - host.clientLeft,
        top: (scrolls ? -padY : -padTop) - host.clientTop,
        width: w + 2 * padX,
        height: h + padTop + padBottom,
        unit,
        cx: padX + w / 2,
        cy: padTop + h / 2,
        hx: w / 2 + grow * growX.x,
        hy,
        radius,
        bodyX: 0,
        bevel: corner === null ? bevel : Math.min(bevel, radius / unit * 1.2),
        band: corner === null ? void 0 : bevel * 0.35,
        shadow: flat ? 0 : 0.12 * lerp(0.55, 1, pc),
        shadowSoftness: 34 * lerp(0.6, 1, pc),
        shadowOffset: 22 * lerp(0.5, 1, pc),
        strength: 1,
        // The kit's stock shading is built for busy backdrops; on a pale page it reads as a grey ring.
        tune: { inner: 0.22, reflection: 0.25 },
        color,
        surface: surfaceRgb,
        edgeClear: 0.2,
        cursorLight: true,
        refraction: {
          paint: (back) => {
            back.translate(padX, padTop);
            back.fillStyle = rgbCss(surfaceRgb);
            back.fillRect(-padX, -padTop, w + 2 * padX, h + padTop + padBottom);
            const r = host.getBoundingClientRect(), lx = r.left + (r.width - w) / 2, ly = r.top + (r.height - h) / 2;
            const target = back.canvas, now = performance.now();
            const key = moves ? `${target.width}:${target.height}:${Math.round(lx * 2)}:${Math.round(ly * 2)}` : `${target.width}:${target.height}`;
            page.ctx ??= page.canvas.getContext("2d");
            const live2 = !!o.live?.(), frameId = document.timeline.currentTime;
            const due = !page.at || now - page.at > 120 && !(moves && readFrame === frameId);
            if (!live2 && !due && !page.timer && (moves || page.stale || key !== page.key)) page.timer = window.setTimeout(() => {
              page.timer = 0;
              scrolled = true;
              engine3.wake();
            }, 120);
            let fresh = false;
            if (page.ctx && (live2 || due && (page.stale || key !== page.key || moves))) {
              fresh = true;
              page.stale = false;
              page.key = key;
              page.at = now;
              if (moves) readFrame = frameId;
              if (page.canvas.width !== target.width || page.canvas.height !== target.height) {
                page.canvas.width = target.width;
                page.canvas.height = target.height;
              }
              const pg = page.ctx;
              pg.setTransform(1, 0, 0, 1, 0, 0);
              pg.clearRect(0, 0, target.width, target.height);
              pg.setTransform(back.getTransform());
              drawDom(pg, document.body, {
                origin: { left: lx, top: ly },
                region: { left: lx - padX, top: ly - padTop, right: lx + w + padX, bottom: ly + h + padBottom },
                // Glass never shows other glass.
                skip: (el) => el.hasAttribute("data-glass-host") || el.hasAttribute("data-glass-skip"),
                onStale: () => {
                  page.stale = true;
                  view.dirty = true;
                  engine3.wake();
                }
              });
            }
            back.save();
            back.setTransform(1, 0, 0, 1, 0, 0);
            back.drawImage(page.canvas, 0, 0);
            back.restore();
            if (fresh) {
              const s = target.width / (w + 2 * padX);
              if (readShade(target, padX * s, padTop * s, w * s, h * s, tint, color)) {
                const b = host.getBoundingClientRect();
                ink((el) => {
                  const q = el === host ? b : el.getBoundingClientRect();
                  const L = shadeIn((q.left - b.left) / b.width, (q.top - b.top) / b.height, (q.right - b.left) / b.width, (q.bottom - b.top) / b.height);
                  return el.hasAttribute("data-glass-light") ? L < 0.21 : L < 0.16;
                });
              }
            }
          },
          refract: lerp(44, 37, pc),
          magnify: 0,
          dispersion: 0.12,
          blurCenter: 0,
          blurEdge: 0,
          frost: tint,
          blur,
          blurMix: 1
        },
        screenX: rect.left + rect.width / 2,
        screenY: rect.top + rect.height / 2
      };
    },
    drawn: () => {
      if (!ready) {
        ready = true;
        host.dataset.glassReady = "";
      }
    },
    lost: unready
  };
  const ac = new AbortController(), on = { signal: ac.signal };
  const dirty = () => {
    view.dirty = true;
    engine3.wake();
  };
  if (o.swell) {
    const off = () => host.matches(":disabled, [aria-disabled='true']");
    host.addEventListener("pointerdown", () => {
      if (!off()) {
        pressed = true;
        engine3.wake();
      }
    }, on);
    for (const t of ["pointerup", "pointercancel"]) host.addEventListener(t, () => {
      pressed = false;
      engine3.wake();
    }, on);
    host.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse" && !off()) {
        hovered = true;
        dirty();
      }
    }, on);
    host.addEventListener("pointerleave", () => {
      pressed = hovered = false;
      dirty();
    }, on);
  }
  const io = new IntersectionObserver(([e]) => {
    view.visible = e.isIntersecting;
    dirty();
  });
  io.observe(host);
  const ro = new ResizeObserver(dirty);
  ro.observe(host);
  const mo = new MutationObserver(dirty);
  mo.observe(host, { attributes: true, attributeFilter: ["class", "disabled", "aria-pressed", "aria-current", "hidden"] });
  addEventListener("scroll", () => {
    if (moves) {
      scrolled = true;
      engine3.wake();
    }
  }, { passive: true, capture: true, signal: ac.signal });
  for (const t of ["transitionrun", "transitionend"]) host.addEventListener(t, (e) => {
    if (e.target === host) dirty();
  }, on);
  if (o.live) document.addEventListener("play", dirty, { capture: true, signal: ac.signal });
  let gone = false;
  document.fonts?.ready.then(() => {
    if (!gone) dirty();
  });
  engine3.add(view);
  return () => {
    gone = true;
    ac.abort();
    io.disconnect();
    ro.disconnect();
    mo.disconnect();
    clearTimeout(page.timer);
    engine3.remove(view);
    canvas.remove();
    for (const el of /* @__PURE__ */ new Set([host, ...labels])) el.removeAttribute("data-glass-light");
    for (const a of ["data-glass-host", "data-glass-clip", "data-glass-ready"]) host.removeAttribute(a);
  };
}

// src/lens.ts
var UNITS = 80;
var OPTICS = UNITS * 1.35 / 120;
var clipped = (el) => {
  for (; el && el !== document.body; el = el.parentElement) if (/auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  return false;
};
var icons = /* @__PURE__ */ new WeakMap();
function drawIcon(ctx, el, color, x, y, w, h, redraw) {
  let by = icons.get(el);
  if (!by) icons.set(el, by = /* @__PURE__ */ new Map());
  let img = by.get(color);
  if (!img) {
    const c = el.cloneNode(true);
    c.removeAttribute("class");
    c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    c.setAttribute("width", String(w));
    c.setAttribute("height", String(h));
    c.style.color = color;
    img = new Image();
    img.onload = redraw;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(c))}`;
    by.set(color, img);
  }
  if (img.complete && img.naturalWidth) ctx.drawImage(img, x, y, w, h);
}
var shows = (c) => !!c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c);
function paintControl(back, front, root, selected, redraw) {
  const o = root.getBoundingClientRect();
  const k = o.width / (root.offsetWidth || o.width) || 1;
  const walk = (el) => {
    if (el instanceof HTMLCanvasElement || el instanceof HTMLInputElement || el.classList.contains("gc-knob")) return;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return;
    const b = el.getBoundingClientRect(), r = { width: b.width / k, height: b.height / k }, x = (b.left - o.left) / k, y = (b.top - o.top) / k;
    if (st.display !== "contents" && (r.width <= 1 || r.height <= 1)) return;
    if (el instanceof SVGSVGElement) {
      drawIcon(back, el, st.color, x, y, r.width, r.height, redraw);
      drawIcon(front, el, selected, x, y, r.width, r.height, redraw);
      return;
    }
    if (st.display !== "contents") {
      const radius = Math.min(parseFloat(st.borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
      if (shows(st.backgroundColor)) {
        back.beginPath();
        back.roundRect(x, y, r.width, r.height, radius);
        back.fillStyle = st.backgroundColor;
        back.fill();
      }
    }
    for (const n of el.childNodes) {
      if (n instanceof Element) walk(n);
      else if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(n);
        const q = range.getBoundingClientRect(), m = { left: (q.left - o.left) / k, top: (q.top - o.top) / k, width: q.width / k, height: q.height / k };
        if (m.width < 1) continue;
        const raw = n.textContent.trim(), text = st.textTransform === "uppercase" ? raw.toUpperCase() : st.textTransform === "lowercase" ? raw.toLowerCase() : raw;
        for (const [ctx, color] of [[back, st.color], [front, selected]]) {
          ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
          ctx.letterSpacing = st.letterSpacing === "normal" ? "0px" : st.letterSpacing;
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = color;
          const t = ctx.measureText(text);
          ctx.fillText(text, m.left, m.top + (m.height - t.fontBoundingBoxAscent - t.fontBoundingBoxDescent) / 2 + t.fontBoundingBoxAscent);
        }
      }
    }
  };
  walk(root);
}
var Lens = class {
  constructor(root, knob, size) {
    this.root = root;
    this.knob = knob;
    this.w = size.w;
    this.h = size.h;
    this.r = size.r;
    this.bend = size.bend ?? 1;
    this.mag = size.mag ?? 0.12;
    this.pill.className = "gc-in gc-pill";
    this.pill.setAttribute("aria-hidden", "true");
    knob.prepend(this.pill);
    knob.setAttribute("data-glass-skip", "");
    const engine3 = GLASS ? getGlassEngine() : null, canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    if (!engine3 || !ctx) return;
    canvas.className = "gc-canvas";
    canvas.setAttribute("aria-hidden", "true");
    knob.append(canvas);
    let color = [1, 1, 1], surface2 = [1, 1, 1], selected = "#111", fit = false;
    const redraw = () => {
      view.dirty = true;
      engine3.wake();
    };
    const page = { canvas: document.createElement("canvas"), ctx: null, key: "", stale: true };
    const paintPage = (back, padX, padTop, width, height) => {
      const b = root.getBoundingClientRect(), t = back.canvas, key = `${t.width}:${t.height}:${Math.round(b.left * 2)}:${Math.round(b.top * 2)}`;
      page.ctx ??= page.canvas.getContext("2d");
      if (page.ctx && (page.stale || key !== page.key)) {
        page.stale = false;
        page.key = key;
        if (page.canvas.width !== t.width || page.canvas.height !== t.height) {
          page.canvas.width = t.width;
          page.canvas.height = t.height;
        }
        const pg = page.ctx;
        pg.setTransform(1, 0, 0, 1, 0, 0);
        pg.clearRect(0, 0, t.width, t.height);
        pg.setTransform(back.getTransform());
        pg.fillStyle = rgbCss(surface2);
        pg.fillRect(-padX, -padTop, width, height);
        drawDom(pg, document.body, {
          origin: { left: b.left, top: b.top },
          region: { left: b.left - padX, top: b.top - padTop, right: b.left - padX + width, bottom: b.top - padTop + height },
          skip: (el) => el === root || el.hasAttribute("data-glass-host") || el.hasAttribute("data-glass-skip"),
          onStale: () => {
            page.stale = true;
            redraw();
          }
        });
        const host = root.parentElement?.closest("[data-glass-host]");
        if (host?.hasAttribute("data-glass-menu")) {
          const tiny = document.createElement("canvas");
          tiny.width = Math.max(1, t.width >> 5);
          tiny.height = Math.max(1, t.height >> 5);
          tiny.getContext("2d")?.drawImage(page.canvas, 0, 0, tiny.width, tiny.height);
          pg.save();
          pg.setTransform(1, 0, 0, 1, 0, 0);
          pg.imageSmoothingQuality = "high";
          pg.drawImage(tiny, 0, 0, t.width, t.height);
          pg.restore();
        }
        if (host) {
          const st = getComputedStyle(host), c = engine3.resolveColor(st.getPropertyValue("--gc-tint").trim() || "white");
          pg.globalAlpha = clamp((parseFloat(st.getPropertyValue("--gc-tint-amount")) || 0) / 100);
          pg.fillStyle = rgbCss([c[0], c[1], c[2]]);
          pg.fillRect(-padX, -padTop, width, height);
          pg.globalAlpha = 1;
        }
      }
      back.save();
      back.setTransform(1, 0, 0, 1, 0, 0);
      back.drawImage(page.canvas, 0, 0);
      back.restore();
    };
    const view = {
      canvas,
      ctx,
      dirty: true,
      visible: false,
      step: () => {
        const m = this.moved;
        this.moved = false;
        return m;
      },
      lens: (refresh) => {
        const pc = clamp(this.p);
        if (pc < 4e-3 || !showing(knob)) {
          delete knob.dataset.live;
          return null;
        }
        if (refresh) {
          page.stale = true;
          const s = engine3.resolveColor(surfaceColorOf(root.parentElement));
          surface2 = [s[0], s[1], s[2]];
          const c = engine3.resolveColor(getComputedStyle(root).getPropertyValue("--gc-pill").trim() || "#fff");
          color = [c[0], c[1], c[2]];
          selected = getComputedStyle(root).getPropertyValue("--gc-pill-ink").trim() || selected;
          fit = clipped(root);
        }
        const padX = fit ? 0 : 16, padTop = fit ? 0 : Math.round(this.h * 0.3 + 6), padBottom = fit ? 0 : Math.round(this.h * 1.1 + 8);
        const box = root.getBoundingClientRect(), unit = this.h / UNITS;
        const hx = fit ? Math.min(this.w / 2 * this.sx, this.x, root.offsetWidth - this.x) : this.w / 2 * this.sx;
        const hy = fit ? Math.min(this.h / 2 * this.sy, this.y, root.offsetHeight - this.y) : this.h / 2 * this.sy;
        const round = this.r >= Math.min(this.w, this.h) / 2 - 0.5;
        const radius = round ? 999 : Math.min(this.r * this.sy, hx, hy);
        const bevel = lerp(UNITS * 0.42, 62 * OPTICS, pc);
        return {
          left: -padX,
          top: -padTop,
          width: root.offsetWidth + 2 * padX,
          height: root.offsetHeight + padTop + padBottom,
          unit,
          cx: padX + this.x,
          cy: padTop + this.y,
          hx,
          hy,
          radius,
          bodyX: 0,
          bevel: round ? bevel : Math.min(bevel, radius / unit * 1.2),
          band: round ? void 0 : bevel * 0.35,
          shadow: fit ? 0 : 0.12 * lerp(0.55, 1, pc),
          shadowSoftness: 34 * OPTICS * lerp(0.6, 1, pc),
          shadowOffset: 22 * OPTICS * lerp(0.5, 1, pc),
          strength: pc,
          color,
          surface: surface2,
          edgeClear: 0,
          cursorLight: true,
          tune: { inner: 0.22, reflection: 0.25, rim: 0.6 },
          // the stock shading goes muddy on a pale page
          refraction: {
            paint: (back, front) => {
              back.translate(padX, padTop);
              front.translate(padX, padTop);
              paintPage(back, padX, padTop, root.offsetWidth + 2 * padX, root.offsetHeight + padTop + padBottom);
              paintControl(back, front, root, selected, redraw);
            },
            refract: lerp(6, 37, pc) * OPTICS * lerp(0.06, 1, pc) * this.bend,
            magnify: this.mag * pc,
            dispersion: 0.12 * pc * this.bend,
            blurCenter: 0,
            blurEdge: 0,
            frost: 1 - pc
            // 1 is the flat pill, 0 is perfectly clear
          },
          screenX: box.left + this.x,
          screenY: box.top + this.y
        };
      },
      drawn: () => {
        knob.dataset.live = "";
      },
      lost: () => {
        delete knob.dataset.live;
        this.wake = this.nudge = () => {
        };
      }
    };
    this.wake = () => {
      view.dirty = true;
      engine3.wake();
    };
    this.nudge = () => {
      this.moved = true;
      engine3.wake();
    };
    const io = new IntersectionObserver(([e]) => {
      view.visible = e.isIntersecting;
      this.wake();
    });
    io.observe(root);
    document.fonts?.ready.then(() => this.wake());
    engine3.add(view);
    this.teardown = () => {
      io.disconnect();
      engine3.remove(view);
      this.wake = this.nudge = () => {
      };
    };
  }
  w;
  h;
  r;
  bend;
  mag;
  pill = document.createElement("span");
  x = 0;
  y = 0;
  sx = 1;
  sy = 1;
  p = 0;
  wake = () => {
  };
  moved = false;
  nudge = () => {
  };
  teardown = () => {
  };
  /** Place it: centre in the control, stretch on each axis, and how far open it is (0 to 1). */
  pose(x, y, sx, sy, p) {
    this.x = x;
    this.y = y;
    this.sx = sx;
    this.sy = sy;
    this.p = p;
    const s = this.pill.style;
    s.left = `${x - this.w / 2}px`;
    s.top = `${y - this.h / 2}px`;
    s.width = `${this.w}px`;
    s.height = `${this.h}px`;
    s.borderRadius = `${this.r}px`;
    s.transform = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    this.knob.style.setProperty("--gc-p", p.toFixed(3));
    this.nudge();
  }
  /** What is under it changed. */
  refresh() {
    this.wake();
  }
  destroy() {
    this.teardown();
    this.teardown = () => {
    };
  }
};

// src/index.js
var reduceMQ = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
var clamp2 = (v, a, b) => Math.min(b, Math.max(a, v));
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
var tick = (dt) => {
  for (const f of running) if (!f(dt)) running.delete(f);
  return running.size > 0;
};
var raf = 0;
var last = 0;
var loop = (t) => {
  const dt = Math.min(0.05, last ? (t - last) / 1e3 : 1 / 60);
  last = t;
  raf = tick(dt) ? requestAnimationFrame(loop) : 0;
  if (!raf) last = 0;
};
var engine2;
var driven = false;
var drive = () => {
  if (engine2 !== void 0) return;
  engine2 = GLASS ? getGlassEngine() : null;
  if (!engine2) return;
  driven = true;
  const canvas = document.createElement("canvas");
  engine2.add({ canvas, ctx: canvas.getContext("2d"), dirty: false, visible: false, step: tick, lens: () => null, lost: () => {
    driven = false;
    if (running.size && !raf) raf = requestAnimationFrame(loop);
  } });
};
var animate = (f) => {
  running.add(f);
  if (driven) engine2.wake();
  else if (!raf) raf = requestAnimationFrame(loop);
};
var guard = (sig, f) => (dt) => !sig.aborted && f(dt);
var knobOf = (host) => {
  const k = document.createElement("span");
  k.className = "gc-knob";
  k.setAttribute("aria-hidden", "true");
  host.append(k);
  return k;
};
var movingUnder = (el) => () => {
  const r = el.getBoundingClientRect();
  for (const m of document.querySelectorAll("video")) {
    if (m.paused) continue;
    const b = m.getBoundingClientRect();
    if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) return true;
  }
  return false;
};
function button(el, sig, peak = 1.1) {
  const s = new Spring(1, 1e-3), ox = new Spring(0), oy = new Spring(0);
  let held = false, x0 = 0, y0 = 0;
  const frame = guard(sig, (dt) => {
    for (const sp of [s, ox, oy]) sp.step(dt);
    const w = el.offsetWidth || 1, h = el.offsetHeight || 1;
    const ax = Math.abs(ox.x) / w, ay = Math.abs(oy.x) / h;
    const sx = s.x * (1 + 0.9 * ax - 0.45 * ay), sy = s.x * (1 + 0.9 * ay - 0.45 * ax);
    el.style.transform = `translate(${ox.x.toFixed(2)}px, ${oy.x.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    el.style.setProperty("--gc-p", clamp2((s.x - 1) / (peak - 1), 0, 1).toFixed(3));
    const moving = held || ![s, ox, oy].every((sp) => sp.still);
    if (!moving) {
      el.style.transform = "";
      el.style.setProperty("--gc-p", "0");
    }
    return moving;
  });
  const light = (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--gc-lx", `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
    el.style.setProperty("--gc-ly", `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`);
  };
  const on = { signal: sig };
  el.addEventListener("pointerdown", (e) => {
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
    for (const p of ["transform", "--gc-p", "--gc-lx", "--gc-ly"]) el.style.removeProperty(p);
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
  const g = new Lens(host, knob, { w: W, h: H, r: H / 2, bend: 0.35 });
  const min = +range.min || 0, max = range.max === "" ? 100 : +range.max, step = +range.step || 1;
  const geo = () => {
    const b = host.getBoundingClientRect(), t = track.getBoundingClientRect();
    return { left: b.left, tx: t.left - b.left, tw: t.width, cy: t.top - b.top + t.height / 2 };
  };
  const at = (val, G = geo()) => G.tx + RW / 2 + (val - min) / (max - min) * (G.tw - RW);
  const x = new Spring(at(+range.value), 0.05, 0.28, 0.75), s = new Spring(REST, 1e-3);
  let held = false, px = 0, px0 = 0, f0 = 0, tw0 = 1, pressed = "";
  const frac = () => clamp2(f0 + (px - px0) / (tw0 - RW), 0, 1);
  const frame = guard(sig, (dt) => {
    const G = geo();
    if (held) x.to = G.tx + RW / 2 + frac() * (G.tw - RW);
    x.step(dt);
    s.step(dt);
    const st = clamp2(Math.abs(x.v) / 2400, 0, 0.28);
    const fill = x.x - G.tx;
    host.style.setProperty("--gc-fill-w", fill <= RW / 2 + 0.5 ? "0px" : `${fill.toFixed(2)}px`);
    g.pose(x.x, G.cy, s.x * (1 + st), s.x * (1 - st * 0.45), clamp2((s.x - REST) / (1 - REST), 0, 1) * 0.75);
    return held || !(x.still && s.still);
  });
  const set = () => {
    const before = range.value;
    range.value = String(min + Math.round(frac() * (max - min) / step) * step);
    if (range.value !== before) range.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const start = (cx, id) => {
    const G = geo(), here = cx - G.left;
    f0 = Math.abs(here - x.x) <= RW / 2 + 6 ? (+range.value - min) / (max - min) : clamp2((here - G.tx - RW / 2) / (G.tw - RW), 0, 1);
    held = true;
    px = px0 = cx;
    tw0 = G.tw;
    s.to = 1;
    pressed = range.value;
    host.dataset.glassPointer = "";
    range.focus({ preventScroll: true });
    g.refresh();
    try {
      host.setPointerCapture(id);
    } catch {
    }
    set();
    animate(frame);
  };
  let down = null;
  const on = { signal: sig };
  host.addEventListener("pointerdown", (e) => {
    if (e.button || range.disabled) return;
    if (e.pointerType === "touch") {
      if (!down && !held) down = { x: e.clientX, y: e.clientY, id: e.pointerId, v: range.value };
      return;
    }
    e.preventDefault();
    start(e.clientX, e.pointerId);
  }, on);
  host.addEventListener("pointermove", (e) => {
    if (down && !held) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) start(down.x, down.id);
    }
    if (held) {
      px = e.clientX;
      set();
    }
  }, on);
  const up = (e) => {
    if (down && !held && e.type === "pointerup") start(down.x, down.id);
    const was = down;
    down = null;
    if (!held) return;
    held = false;
    s.to = REST;
    if (e.type === "pointercancel" && was && range.value !== was.v) {
      range.value = was.v;
      range.dispatchEvent(new Event("input", { bubbles: true }));
    }
    x.to = at(+range.value);
    animate(frame);
    if (e.type === "pointerup" && range.value !== pressed) range.dispatchEvent(new Event("change", { bubbles: true }));
  };
  host.addEventListener("pointerup", up, on);
  host.addEventListener("pointercancel", up, on);
  const follow = () => {
    if (!held) {
      x.to = at(+range.value);
      animate(frame);
    }
  };
  range.addEventListener("input", follow, on);
  for (const t of ["keydown", "blur"]) range.addEventListener(t, () => delete host.dataset.glassPointer, on);
  range.form?.addEventListener("reset", () => setTimeout(follow), on);
  const ro = new ResizeObserver(() => {
    g.refresh();
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
    delete host.dataset.glassPointer;
  };
}
function segmented(group, sig) {
  const items = [...group.querySelectorAll("button, a[href]")];
  if (!items.length) return () => {
  };
  group.classList.add("gc-seg");
  const knob = knobOf(group);
  const vertical = group.getAttribute("aria-orientation") === "vertical";
  const box = (b) => {
    const g2 = group.getBoundingClientRect(), r = b.getBoundingClientRect();
    return { cx: r.left - g2.left + r.width / 2, cy: r.top - g2.top + r.height / 2, w: r.width, h: Math.round(b.offsetHeight) || 36 };
  };
  const isChosen = (b) => b.getAttribute("aria-pressed") === "true" || b.hasAttribute("aria-current") && b.getAttribute("aria-current") !== "false";
  const current = () => items.find(isChosen);
  const chosen = () => current() ?? items[0];
  let B = box(chosen());
  const radius = (h) => Math.min(h / 2, parseFloat(getComputedStyle(chosen()).borderTopLeftRadius) || h / 2);
  const g = new Lens(group, knob, { w: B.w, h: B.h, r: radius(B.h), bend: 0.3, mag: vertical ? 0 : 0.05 });
  const x = new Spring(B.cx, 0.05, 0.34, 0.68), y = new Spring(B.cy, 0.05, 0.34, 0.68), s = new Spring(1, 1e-3), wide = new Spring(B.w, 0.05, 0.34, 0.68);
  let held = false, dragged = false, x0 = 0, y0 = 0, px = 0, py = 0, pid = 0, pressedItem = null;
  const size = (w) => {
    wide.to = w;
    g.h = B.h;
    g.r = radius(B.h);
  };
  const frame = guard(sig, (dt) => {
    const r = group.getBoundingClientRect();
    if (held && dragged) {
      const bs = items.map(box);
      y.to = clamp2(py - r.top, Math.min(...bs.map((q) => q.cy)), Math.max(...bs.map((q) => q.cy)));
      const row = bs.filter((q) => Math.abs(q.cy - y.to) < 12);
      const xs = (row.length ? row : bs).map((q) => q.cx);
      x.to = clamp2(px - r.left, Math.min(...xs), Math.max(...xs));
      wide.to = bs.reduce((a2, q) => Math.hypot(q.cx - x.x, (q.cy - y.x) * 2) < Math.hypot(a2.cx - x.x, (a2.cy - y.x) * 2) ? q : a2).w;
      const scroller = group.parentElement;
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        const e = scroller.getBoundingClientRect();
        scroller.scrollLeft += (px < e.left + 36 ? -420 : px > e.right - 36 ? 420 : 0) * dt;
      }
    }
    x.step(dt);
    y.step(dt);
    s.step(dt);
    wide.step(dt);
    group.classList.toggle("gc-none", !held && !current());
    const speed = Math.hypot(x.v, y.v), st = clamp2(speed / 2600, 0, 0.25);
    const horiz = Math.abs(x.v) >= Math.abs(y.v), a = s.x * (1 + st), b = s.x * (1 - st * 0.4);
    g.w = wide.x;
    const wider = horiz ? a : b, sx = vertical ? Math.min(wider, 1) : wider;
    const cap = group.closest('[data-glass="surface"]'), hw = g.w * sx / 2;
    let cx = x.x;
    if (cap && !/auto|scroll/.test(getComputedStyle(cap).overflowX)) {
      const c = cap.getBoundingClientRect();
      if (c.width >= 2 * hw) cx = clamp2(x.x, c.left - r.left + hw, c.right - r.left - hw);
    }
    const open = clamp2(Math.max((s.x - 1) / 0.15, speed / 500), 0, 1);
    g.pose(cx, y.x, sx, horiz ? b : a, vertical ? open * 0.6 : open);
    return held || !(x.still && y.still && s.still && wide.still);
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
  group.addEventListener("focusin", (e) => {
    if (e.target.matches(":focus-visible")) e.target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, on);
  group.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    held = true;
    dragged = false;
    pid = e.pointerId;
    x0 = px = e.clientX;
    y0 = py = e.clientY;
    s.to = 1.15;
    g.refresh();
    const b = pressedItem = e.target.closest("button, a[href]");
    if (b && items.includes(b)) {
      if (!current()) {
        B = box(b);
        size(B.w);
        wide.snap();
        x.to = B.cx;
        y.to = B.cy;
        x.snap();
        y.snap();
      } else if (b !== chosen()) goTo(b);
    }
    animate(frame);
  }, on);
  group.addEventListener("pointermove", (e) => {
    if (!held) return;
    px = e.clientX;
    py = e.clientY;
    if (!dragged && (vertical ? Math.abs(py - y0) : Math.abs(px - x0)) > 8) {
      dragged = true;
      group.setPointerCapture(e.pointerId);
      size(B.w);
    }
  }, on);
  const up = (e) => {
    if (!held || e.pointerId !== pid) return;
    held = false;
    s.to = 1;
    if (e.type === "pointercancel" || !dragged && e.target.closest?.("button, a[href]") !== pressedItem) goTo(chosen());
    else if (dragged) {
      const b = nearest();
      goTo(b);
      if (b !== chosen() || !current()) b.click();
    }
    animate(frame);
  };
  addEventListener("pointerup", up, on);
  addEventListener("pointercancel", up, on);
  const mo = new MutationObserver(() => {
    goTo(chosen());
    g.refresh();
  });
  mo.observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "aria-current"] });
  const ro = new ResizeObserver(() => {
    B = box(chosen());
    size(B.w);
    wide.snap();
    g.refresh();
    x.to = B.cx;
    y.to = B.cy;
    x.snap();
    y.snap();
    animate(frame);
  });
  ro.observe(group);
  animate(frame);
  return () => {
    mo.disconnect();
    ro.disconnect();
    g.destroy();
    knob.remove();
    group.classList.remove("gc-seg", "gc-none");
  };
}
function toggle(host, sig) {
  const input = host.querySelector('input[type="checkbox"]');
  if (!input) return () => {
  };
  const addedRole = !input.hasAttribute("role");
  if (addedRole) input.setAttribute("role", "switch");
  const sw = document.createElement("span");
  sw.className = "gc-sw";
  sw.setAttribute("aria-hidden", "true");
  host.append(sw);
  const knob = knobOf(sw), W = 55, H = 24, KW = 32.4, KH = 20.4, PAD = (H - KH) / 2, PEAK = 1.35;
  const g = new Lens(sw, knob, { w: KW, h: KH, r: KH / 2, bend: 0.5 });
  const pos = new Spring(input.checked ? 1 : 0, 2e-3, 0.42, 0.7), s = new Spring(0, 2e-3);
  let held = false;
  const frame = guard(sig, (dt) => {
    pos.to = input.checked ? 1 : 0;
    s.to = held || Math.abs(pos.x - pos.to) > 0.08 ? 1 : 0;
    pos.step(dt);
    s.step(dt);
    const p = clamp2(s.x, 0, 1), k = 1 + (PEAK - 1) * p;
    sw.style.setProperty("--gc-on", clamp2(pos.x, 0, 1).toFixed(3));
    g.pose(PAD + KW / 2 + pos.x * (W - KW - 2 * PAD), H / 2, k, k, p * 0.6);
    return held || !(pos.still && s.still);
  });
  const on = { signal: sig };
  host.addEventListener("pointerdown", (e) => {
    if (!e.button && !input.disabled) {
      held = true;
      g.refresh();
      animate(frame);
    }
  }, on);
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) host.addEventListener(t, () => {
    held = false;
    animate(frame);
  }, on);
  input.addEventListener("change", () => animate(frame), on);
  input.form?.addEventListener("reset", () => setTimeout(() => animate(frame)), on);
  animate(frame);
  return () => {
    g.destroy();
    sw.remove();
    if (addedRole) input.removeAttribute("role");
  };
}
var live = 0;
function init(root) {
  const ac = new AbortController(), sig = ac.signal, undo = [];
  if (typeof ResizeObserver === "undefined") return { destroy() {
  } };
  root ??= document;
  drive();
  const on = !!engine2;
  const mode = on ? "gc-live" : "gc-plain";
  if (!live++) document.documentElement.classList.add(mode);
  const all = (v) => [...root.querySelectorAll(`[data-glass="${v}"]:not(.gc)`)];
  const mark = (el, ...fs) => {
    el.classList.add("gc");
    undo.push(() => el.classList.remove("gc"), ...fs.filter(Boolean));
  };
  for (const el of all("surface")) mark(el, el.hasAttribute("data-glass-menu") ? surface(el, { frosted: true }) : on && surface(el, { live: movingUnder(el) }));
  for (const el of all("button")) mark(el, on && surface(el, { swell: true, live: movingUnder(el) }), button(el, sig, +el.dataset.glassPeak || 1.1));
  for (const el of all("switch")) mark(el, toggle(el, sig));
  for (const el of all("slider")) mark(el, slider(el, sig));
  for (const el of all("segmented")) mark(el, segmented(el, sig));
  return {
    destroy() {
      if (sig.aborted) return;
      ac.abort();
      for (const f of undo.reverse()) f();
      if (!--live) document.documentElement.classList.remove(mode);
    }
  };
}
export {
  Spring,
  init
};
/*! Liquid Glass engine, MIT License, Copyright (c) 2026 Bilal Abdullah Gürşen. https://github.com/bilalgursen/liquid-glass */
/*! DOM snapshot from Liquid Glass, MIT License, Copyright (c) 2026 Bilal Abdullah Gürşen. https://github.com/bilalgursen/liquid-glass */
