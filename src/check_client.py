#!/usr/bin/env python3
"""Static guard for the bundled Client module.

Runs the built client.js in a sandbox whose global object answers `in` for every
name, so any unqualified reference to a missing identifier is reported with its
own name instead of silently becoming `undefined` and crashing the slot later.

The failure this catches: a helper is renamed or deleted but one call site
survives. At runtime the reference throws, the slot error boundary swallows the
entry, and the plugin simply never appears — with no visible error in the app.
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
const real = {
  window: { innerWidth: 1440, innerHeight: 900, addEventListener(){}, removeEventListener(){} },
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Object, Array,
  Math, Uint32Array, Float64Array, JSON, Number, String, Boolean, Date, Error, TypeError,
  RangeError, Map, Set, WeakMap, Symbol, RegExp, encodeURIComponent, decodeURIComponent,
  isNaN, isFinite, parseInt, parseFloat,
  HTMLElement: function(){}, Element: function(){}, Node: function(){},
  MutationObserver: class { observe(){} disconnect(){} },
  FontFace: class { load(){ return Promise.resolve(this) } },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false }),
};
const el = () => ({
  getBoundingClientRect: () => ({ left:0, top:0, right:0, bottom:0, width:120, height:120 }),
  classList: { add(){}, remove(){}, toggle(){} },
  addEventListener(){}, removeEventListener(){}, setPointerCapture(){}, releasePointerCapture(){},
  style: {}, appendChild(){}, setAttribute(){}, hasAttribute: () => false,
});
real.document = {
  body: { hasAttribute: () => false, classList: { add(){}, remove(){} }, style: { setProperty(){} } },
  documentElement: { dataset: { platform: 'darwin' }, classList: { add(){}, remove(){} }, style: { setProperty(){} } },
  fonts: { check: () => true, add(){} },
  querySelector: () => el(), querySelectorAll: () => [],
  createElement: () => el(), head: { appendChild(){} }, addEventListener(){},
};
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

// Faithful minimal React: only the hooks the browser module table exposes.
const React = {
  createElement: (t, p, ...c) => ({ t, p, c }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect(){}, useMemo: (f) => f(), useCallback: (f) => f,
  useRef: () => ({ current: null }), Fragment: 'F',
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
// Render the tree, not just the root. The fake createElement above never calls a
// child component, so a helper that is only reached from inside <Verse> — or from
// any other child — used to go untested. Walk the element tree and invoke every
// function component, which is where most of this module's code lives.
function render(el, depth) {
  if (el === null || el === undefined || typeof el !== 'object') return;
  if (Array.isArray(el)) { for (const child of el) render(child, depth); return; }
  if (depth > 40) throw new Error('render depth exceeded (cycle?)');
  const { t, p, c } = el;
  if (typeof t === 'function') {
    const props = Object.assign({}, p);
    render(t(props), depth + 1);
    return;
  }
  if (Array.isArray(c)) for (const child of c) render(child, depth + 1);
}

for (const r of reg) {
  try {
    render(r.c({}), 0);
  } catch (e) {
    console.error(`render failed in '${r.o.id}': ${e.message}`);
    process.exit(2);
  }
}
if (found.size) {
  console.error('undefined identifiers: ' + [...found].join(', '));
  process.exit(1);
}
console.log(`guard ok (${reg.length} slot entries rendered)`);
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
