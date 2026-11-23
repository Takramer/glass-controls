// Runs without a browser: the built package must import on a server, and its spring must settle.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { Spring, init } from '../dist/glass-controls.js'

const s = new Spring(0, 0.001)
s.to = 1
let peak = 0, frames = 0
while (!s.still && frames++ < 600) { s.step(1 / 60); peak = Math.max(peak, s.x) }
assert.ok(s.still, 'the spring settles')
assert.ok(peak > 1 && peak < 1.12, `one small overshoot, got ${peak.toFixed(3)}`)
assert.equal(typeof init().destroy, 'function', 'init is a no-op without a DOM')

// The entry points a consumer imports.
assert.equal((await import('glass-controls')).Spring, Spring, 'the package name resolves to the bundle')
assert.ok(existsSync(new URL(import.meta.resolve('glass-controls/glass-controls.css'))), 'the CSS entry point exists')

const js = readFileSync(new URL('../dist/glass-controls.js', import.meta.url), 'utf8')
assert.ok(js.includes('Bilal Abdullah'), 'the engine keeps its MIT notice in the bundle')
assert.ok(!/^import\s/m.test(js), 'the bundle has no runtime dependency')
const css = readFileSync(new URL('../dist/glass-controls.css', import.meta.url), 'utf8')
for (const v of ['--gc-tint-amount: 32%', '--gc-blur: 1px', '--gc-menu-tint-amount: 66%', '--gc-menu-blur: 16px']) assert.ok(css.includes(v), v)
console.log('check passed')
