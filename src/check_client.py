#!/usr/bin/env python3
"""Static guard for the bundled Client module.

Runs the built client.js in a sandbox whose global object answers `in` for every
name, so any unqualified reference to a missing identifier is reported with its
own name instead of silently becoming `undefined` and crashing the slot later.

The failure this catches: a helper is renamed or deleted but one call site
survives. At runtime the reference throws, the slot error boundary swallows the
entry, and the plugin simply never appears — with no visible error in the app.

Both layout branches are rendered on purpose. The verse has a vertical and a
horizontal branch and they do not share their element tree, so a reference that
only exists in one of them survives any amount of eyeballing the other. That is
exactly how an undeclared `seal` in the horizontal branch shipped once: every
manual check happened to hit the vertical path, and the crash only showed up once
the window got narrow enough to force the horizontal one. Rendering both here
turns that class of bug into a failed build instead of a support report.
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT = os.path.join(HERE, 'client.js')

HARNESS = r'''
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[2], 'utf8');
const found = new Set();

// ---------------------------------------------------------------------------
// A small DOM. It answers the handful of queries the module actually makes, with
// rects that put the composer in the middle of the window and leave the right
// rail collapsed — the normal desktop shape. Values matter: the verse geometry
// is derived from them, and a degenerate rect would only ever reach one branch.
// ---------------------------------------------------------------------------
const VIEW = { w: 1440, h: 900 };
// The composer rect decides the gutter the verse is allowed to use, and the gutter
// decides which layout is reachable. A wide composer leaves a 50 px gutter, which
// is the one shape where both branches can actually be selected: the vertical form
// still fits (48.25 px is its floor) and the horizontal one cannot (it needs the
// full clause width). With a realistic composer only one branch is ever reachable,
// and the other one then ships untested — which is exactly how an undeclared
// `seal` survived in the horizontal branch.
const COMPOSER = { left: 58, top: 760, right: 1382, bottom: 840, width: 1324, height: 80 };
const EMPTY = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

const store = new Map();
const styleNodes = [];

class BaseEl {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.id = '';
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.classList = { add(){}, remove(){}, toggle(){}, contains: () => false };
    this.nodeType = 1;
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    return child;
  }
  remove() {
    const i = styleNodes.indexOf(this);
    if (i >= 0) styleNodes.splice(i, 1);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute() { return false; }
  addEventListener() {}
  removeEventListener() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return Object.assign({}, EMPTY); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

class HTMLDivElement extends BaseEl {}
class HTMLStyleElement extends BaseEl {}

function makeElement(tag) {
  return tag === 'style' ? new HTMLStyleElement(tag) : new HTMLDivElement(tag);
}

// Per-selector rects, because the module reads different boxes for different
// reasons: the composer sizes the veil, the right rail decides which side the
// verse takes.
function rectFor(selector) {
  if (!selector) return EMPTY;
  if (selector.indexOf('data-rightbar-col') >= 0) return EMPTY;   // rail collapsed
  if (selector.indexOf('data-shell-overlay') >= 0) return COMPOSER;
  if (selector.indexOf('composer') >= 0) return COMPOSER;
  if (selector.indexOf('contenteditable') >= 0 || selector.indexOf('textarea') >= 0) return COMPOSER;
  return EMPTY;
}

function querySelector(selector) {
  if (selector.indexOf('data-shell-overlay') >= 0) return null;   // no frame node
  const node = makeElement('div');
  node.getBoundingClientRect = () => rectFor(selector);
  return node;
}

const documentStub = {
  body: makeElement('body'),
  documentElement: makeElement('html'),
  head: makeElement('head'),
  fonts: { check: () => true, add() {}, ready: Promise.resolve() },
  styleSheets: [],
  querySelector,
  querySelectorAll: () => [],
  getElementById: (id) => styleNodes.filter((node) => node.id === id)[0] || null,
  createElement: (tag) => makeElement(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  addEventListener() {},
  removeEventListener() {},
};
documentStub.documentElement.dataset.platform = 'darwin';
documentStub.head.appendChild = (node) => { styleNodes.push(node); return node; };

const real = {
  window: {
    innerWidth: VIEW.w,
    innerHeight: VIEW.h,
    devicePixelRatio: 2,
    visualViewport: { addEventListener() {}, removeEventListener() {}, width: VIEW.w, height: VIEW.h },
    location: { href: 'dsh-app://app/', origin: 'dsh-app://app' },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => { if (typeof fn === 'function') return 1; return 1 },
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)) },
      removeItem: (k) => { store.delete(String(k)) },
    },
  },
  document: documentStub,
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Object, Array,
  Math, Uint32Array, Float64Array, JSON, Number, String, Boolean, Date, Error, TypeError,
  RangeError, Map, Set, WeakMap, WeakSet, Symbol, RegExp, encodeURIComponent, decodeURIComponent,
  isNaN, isFinite, parseInt, parseFloat,
  HTMLElement: BaseEl, Element: BaseEl, Node: BaseEl,
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  FontFace: class { constructor(family, source) { this.family = family; this.source = source } load() { return Promise.resolve(this) } },
  URL, URLSearchParams, TextEncoder, TextDecoder,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => { if (typeof fn === 'function') return 1; return 1 },
  cancelAnimationFrame() {},
  performance: { now: () => 0 },
};
real.window.document = documentStub;
real.window.window = real.window;
real.globalThis = real;

let loaded;
real.window.__ModuleLoader__ = { load(m) { loaded = m } };

const proxy = new Proxy(real, {
  has: () => true,
  get(t, k) {
    if (k in t) return t[k];
    if (k === Symbol.unscopables) return undefined;
    found.add(String(k));
    throw new Error('UNDEFINED: ' + String(k));
  },
});
vm.createContext(proxy);
try { vm.runInContext(src, proxy); }
catch (e) { console.error('module body threw: ' + e.message); process.exit(2); }

if (!loaded) { console.error('no factory registered'); process.exit(2); }
if (loaded.id !== 'dsh-ink-poem-wallpaper') { console.error('wrong factory id: ' + loaded.id); process.exit(2); }

// Faithful-enough React: the hooks the browser module table exposes, plus
// Component, because the module installs its own error boundary and a double
// without Component would reject a correct module.
class Component {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.timer = null;
  }
  setState(updater) {
    const next = typeof updater === 'function' ? updater(this.state) : updater;
    this.state = Object.assign({}, this.state, next);
  }
  forceUpdate() {}
  componentWillUnmount() {}
  render() { return null; }
}

const React = {
  createElement: (t, p, ...c) => ({ t, p: p || {}, c }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect() {}, useLayoutEffect() {},
  useMemo: (f) => f(), useCallback: (f) => f,
  useRef: () => ({ current: null }),
  Fragment: 'F',
  Component,
};
const factory = loaded.factory((n) => {
  if (n === 'react') return React;
  throw new Error('unexpected require: ' + n);
});
const reg = [];
factory.apply({
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
  slots: { inject: (k, cb) => cb(), register: (o, c) => { reg.push({ o, c }); return () => {}; } },
});

// Render the whole tree, not just the root: invoke every function component and
// instantiate every class component, because that is where the module's code is.
function render(el, depth, modes) {
  if (el === null || el === undefined || typeof el !== 'object') return;
  if (Array.isArray(el)) { for (const child of el) render(child, depth, modes); return; }
  if (depth > 60) throw new Error('render depth exceeded (cycle?)');
  const { t, p, c } = el;
  if (p && p.style && p.style.writingMode) modes.add(p.style.writingMode);
  if (typeof t === 'function') {
    const props = Object.assign({}, p);
    if (t.prototype instanceof Component) {
      const instance = new t(props);
      instance.props = props;
      render(instance.render(), depth + 1, modes);
      return;
    }
    render(t(props), depth + 1, modes);
    return;
  }
  if (Array.isArray(c)) for (const child of c) render(child, depth + 1, modes);
}

const SETTINGS_KEY = 'dsh-ink-poem-wallpaper:v1';
// The two layouts a user can actually end up with. `vertical: null` is the
// automatic mode and it resolves to the vertical branch on a desktop-width
// window, which is why the horizontal branch needs to be asked for by name.
const PASSES = [
  { vertical: true, label: 'vertical' },
  { vertical: false, label: 'horizontal' },
];

// A slot registers either a function component or a class component (this module
// registers a class, its own error boundary), and the two are not called the same
// way — a class has to be constructed before its render() can be walked.
function renderComponent(Type, modes) {
  if (typeof Type !== 'function') return;
  if (Type.prototype instanceof Component) {
    const instance = new Type({});
    instance.props = {};
    render(instance.render(), 0, modes);
    return;
  }
  render(Type({}), 0, modes);
}

const renderedModes = new Set();
for (const pass of PASSES) {
  store.set(SETTINGS_KEY, JSON.stringify({ enabled: true, vertical: pass.vertical, showSource: true }));
  for (const r of reg) {
    try {
      renderComponent(r.c, renderedModes);
    } catch (e) {
      const message = String(e && e.message ? e.message : e);
      if (message.indexOf('UNDEFINED: ') === 0) {
        console.error(`undefined identifier while rendering '${r.o.id}' (${pass.label}): ${message.slice(11)}`);
        process.exit(1);
      }
      console.error(`render failed in '${r.o.id}' (${pass.label}): ${message}`);
      process.exit(2);
    }
  }
}

if (found.size) {
  console.error('undefined identifiers: ' + [...found].join(', '));
  process.exit(1);
}

// Prove both branches were actually reached. Rendering "successfully" while the
// wrapper silently swallowed one layout is how the original bug survived, so a
// missing branch is a failure, not a pass.
const missing = [];
if (!renderedModes.has('vertical-rl')) missing.push('vertical');
if (!renderedModes.has('horizontal-tb')) missing.push('horizontal');
if (missing.length) {
  console.error('layout branch never rendered: ' + missing.join(', '));
  process.exit(2);
}

console.log(`guard ok (${reg.length} slot entries rendered, both layouts)`);
'''

def main():
    if not os.path.exists(CLIENT):
        sys.exit('build client.js first')
    # A private temp file, not a fixed name in /tmp: a predictable path can be
    # pre-created by another user and hijacked.
    handle, script = tempfile.mkstemp(prefix='ipw-guard-', suffix='.cjs')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            stream.write(HARNESS)
        result = subprocess.run(['node', script, CLIENT], capture_output=True, text=True)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        return result.returncode
    finally:
        try:
            os.unlink(script)
        except OSError:
            pass


if __name__ == '__main__':
    sys.exit(main())
