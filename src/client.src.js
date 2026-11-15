/**
 * Ink-poem wallpaper — Client half.
 *
 * Paints a generated ink-wash (水墨) landscape behind the Harness shell and sets one
 * couplet from the Chinese poetry corpus into it, in a brush script. Painting and
 * verse share the same mood tags, so the picture agrees with the poem instead of
 * being decorative wallpaper the text happens to sit on.
 *
 * Where each piece lives, and why:
 *   1. The painting and its paper veil — the `body` background, injected as a
 *      stylesheet. A slot entry cannot paint beneath the app: `shell.overlay` is its
 *      own stacking context above the frame, so reaching the page canvas is the only
 *      way to sit behind every column. Two background layers, veil first so it paints
 *      on top: dense behind the transcript, clear in the side gutters.
 *   2. The shell's own fills — neutralised through one token (`--dsw-alias-bg-base`
 *      becomes transparent), so columns stop double-painting over the painting
 *      while cards, menus and the composer keep their own opaque layer-1/2 fills.
 *   3. The verse and its controls — a `shell.overlay` entry above the app, anchored
 *      in a side gutter measured from the live layout, so the transcript and the
 *      composer never cover it.
 *
 * All registrations happen inside `apply`, and every resource is owned by the React
 * tree or by an effect, so removing the plugin removes the wallpaper completely.
 */

window.__ModuleLoader__.load({
  id: 'dsh-ink-poem-wallpaper',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ================================================================== *
     * Corpus — quoted from chinese-poetry (MIT), simplified with OpenCC.
     * Row shape: [couplet, author, title, dynasty, "mood,mood"].
     * ================================================================== */

    const QUOTES = RAW_QUOTES.map((row) => ({
      q: row[0], a: row[1], t: row[2], d: row[3],
      m: row[4] ? row[4].split(',') : [],
    }))

    const DAY_MS = 86400000

    function dayNumber(date) {
      const local = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      return Math.round(local.getTime() / DAY_MS)
    }

    /** FNV-1a: one couplet always grows the same landscape. */
    function hash(text) {
      let acc = 2166136261
      for (let i = 0; i < text.length; i += 1) {
        acc ^= text.charCodeAt(i)
        acc = Math.imul(acc, 16777619)
      }
      return acc >>> 0
    }

    /**
     * Today's quote, drawn at random.
     *
     * The old behaviour walked the pool in order, so the same poems came back in the
     * same sequence every cycle. Instead the day number seeds a shuffle of the whole
     * pool: each day is random, a given day is stable across reloads, and no quote
     * repeats until the pool is exhausted (a full cycle, then a fresh permutation).
     */
    function shuffledIndex(day) {
      const total = QUOTES.length
      const rank = new Uint32Array(total)
      for (let i = 0; i < total; i += 1) rank[i] = i
      // Deterministic Fisher–Yates driven by a seeded generator.
      const rand = prng(hash(`cycle:${Math.floor(day / total)}`) ^ 0x85ebca6b)
      for (let i = total - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1))
        const t = rank[i]; rank[i] = rank[j]; rank[j] = t
      }
      return rank[((day % total) + total) % total]
    }

    function pickQuote(index) {
      const total = QUOTES.length
      return QUOTES[((index % total) + total) % total]
    }

    /** Wrap any integer (including a manual offset) into the pool. */
    function wrapIndex(value) {
      const total = QUOTES.length
      return ((value % total) + total) % total
    }

    /* ================================================================== *
     * Settings — browser-local; the wallpaper never leaves this machine.
     * ================================================================== */

    const STORAGE_KEY = 'dsh-ink-poem-wallpaper:v1'

    // Four faces. 行楷 stays the default, using the system brush face. The other
    // three are shipped with the bundle and subset to exactly the characters the
    // quote pool uses, so every character of every quote is guaranteed to draw —
    // no tofu boxes and no silent substitution mid-poem. All three are SIL OFL.
    const FONT_BASE = '/ink-poem-wallpaper'
    /**
     * The fixed seal artwork, served from the bundle: one file per shape, so the
     * round stamp has its own inscribed border and the square one keeps its
     * straight sides. Cropping one square image to a disc left the inscription
     * floating inside a ring that did not belong to it.
     */
    const SEAL_ART = {
      square: `${FONT_BASE}/seal.webp`,
      round: `${FONT_BASE}/seal-round.webp`,
    }

    const FONTS = {
      // 行楷 — system face: the closest widely installed brush script.
      xingkai: {
        label: '行楷',
        family: '"Xingkai SC","STXingkai","HanziPen SC","Hannotate SC","华文行楷",'
          + '"STKaiti","KaiTi","Kaiti SC","AR PL UKai CN",cursive',
      },
      // 草书 — Liu Jian Mao Cao: the wildest of the four, true 草书.
      caoshu: {
        label: '草书',
        file: 'liujianmaocao.woff2',
        family: '"Ink Poem Mao Cao",cursive',
      },
      // 行草 — Zhi Mang Xing: flowing running-cursive, easier to read than 草书.
      xingcao: {
        label: '行草',
        file: 'zhimangxing.woff2',
        family: '"Ink Poem Xing Cao",cursive',
      },
      // 行书 — Long Cang: a looser running hand with long, sweeping strokes.
      xingshu: {
        label: '行书',
        file: 'longcang.woff2',
        family: '"Ink Poem Xing Shu",cursive',
      },
    }

    const FONT_FACE_RULES = Object.entries(FONTS)
      .filter(([, spec]) => spec.file)
      .map(([, spec]) => `@font-face{font-family:"${spec.family.split(',')[0].replace(/"/g, '')}";`
        + `src:url("${FONT_BASE}/${spec.file}") format("woff2");`
        // The subset is the whole point: never synthesise or substitute for it.
        + `font-display:block;font-weight:400;font-style:normal;}`)
      .join('\n')

    const DEFAULT_FONT = 'xingkai'

    function fontFamily(key) {
      const spec = FONTS[key]
      return spec ? spec.family : FONTS[DEFAULT_FONT].family
    }

    /**
     * Whether a brush face is actually installed on this machine. 行楷 comes from the
     * system; the other three ship with the bundle, so only that one can be missing.
     * Reported once in the panel instead of silently falling back to a plain 楷体.
     */
    function brushFaceAvailable() {
      if (typeof document === 'undefined' || typeof document.fonts?.check !== 'function') {
        return true
      }
      try {
        return ['Xingkai SC', 'STXingkai', '华文行楷', 'HanziPen SC', 'Hannotate SC']
          .some((name) => document.fonts.check(`16px "${name}"`))
      } catch {
        return true
      }
    }

    /** Resolve every shipped face so the first paint after a switch has glyphs. */
    function preloadFaces() {
      if (typeof document === 'undefined' || typeof FontFace === 'undefined') return
      for (const spec of Object.values(FONTS)) {
        if (!spec.file) continue
        // Use the bare family name, matching the @font-face rule exactly: a quoted
        // name registers a second, distinct face and the browser then reports both.
        const family = spec.family.split(',')[0].replace(/"/g, '')
        try {
          const face = new FontFace(family, `url("${FONT_BASE}/${spec.file}") format("woff2")`)
          face.load()
            .then((loaded) => { document.fonts.add(loaded) })
            .catch(() => {
              /* The stylesheet rule remains as the fallback path. */
            })
        } catch {
          /* A blocked FontFace constructor just leaves the CSS rule in charge. */
        }
      }
    }

    const DEFAULTS = Object.freeze({
      enabled: true,
      offset: null,        // manual steps away from today's quote
      pinnedDay: null,     // the day those steps were taken
      vertical: null,      // null: pick by space, true: 竖排, false: 横排
      side: 'auto',        // auto | left | right
      font: 'xingkai',
      density: 1,
      ink: 'auto',         // auto | light (宣纸) | dark (夜山)
      showSource: true,
      sealShape: 'square',   // square (方印) | round (圆印)
      sealStyle: 'yin',      // yin (白文) | yang (朱文)
      sealScale: 1.15,       // stamp size, a multiple of the verse size
      sealX: null,           // 0..1 fractional position; null = follow the signature
      sealY: null,
      // Free placement. `null` keeps automatic positioning; once the user drags the
      // verse, both stay fixed as a fraction of the window, so every later quote
      // appears in the same place at the same scale on any window size.
      placeX: null,        // 0..1, fractional left position of the verse block
      placeY: null,        // 0..1, fractional top position
      scale: 1,            // verse size multiplier applied to the automatic size
    })

    function clampFraction(value, fallback) {
      if (!Number.isFinite(value)) return fallback
      return Math.min(1, Math.max(0, value))
    }

    function normalize(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      const finite = (value) => Number.isFinite(value)
      return {
        enabled: source.enabled !== false,
        offset: finite(source.offset) ? Math.round(source.offset) : null,
        pinnedDay: finite(source.pinnedDay) ? Math.round(source.pinnedDay) : null,
        vertical: typeof source.vertical === 'boolean' ? source.vertical : null,
        side: ['auto', 'left', 'right'].includes(source.side) ? source.side : 'auto',
        font: Object.prototype.hasOwnProperty.call(FONTS, source.font) ? source.font : DEFAULT_FONT,
        ink: ['auto', 'light', 'dark'].includes(source.ink) ? source.ink : 'auto',
        density: finite(source.density) ? Math.min(1.5, Math.max(0.55, source.density)) : 1,
        showSource: source.showSource !== false,
        sealShape: ['square', 'round'].includes(source.sealShape) ? source.sealShape : 'square',
        sealStyle: ['yin', 'yang'].includes(source.sealStyle) ? source.sealStyle : 'yin',
        sealScale: finite(source.sealScale) ? Math.min(3, Math.max(0.5, source.sealScale)) : 1.15,
        sealX: clampFraction(source.sealX, null),
        sealY: clampFraction(source.sealY, null),
        placeX: clampFraction(source.placeX, null),
        placeY: clampFraction(source.placeY, null),
        scale: finite(source.scale) ? Math.min(2.2, Math.max(0.6, source.scale)) : 1,
      }
    }

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw ? normalize(JSON.parse(raw)) : { ...DEFAULTS }
      } catch {
        return { ...DEFAULTS }
      }
    }

    function writeSettings(next) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* Storage can be unavailable; the wallpaper still works this session. */
      }
    }

    /* ================================================================== *
     * Scene generation
     * ================================================================== */

    const PALETTE = {
      light: {
        paper: '#f8f4ec', edge: '#ece3d4', wash: '#3b362e',
        stroke: '#2a2620', text: '#201d18', seal: '#a63c26', hairline: '#6f675a',
      },
      dark: {
        paper: '#1b1e26', edge: '#101319', wash: '#cfc7b6',
        // Night scene: the paper is charcoal, not black, so a ridge silhouette has
        // something to be darker than.
        ridge: '#101216', stroke: '#e2dbcd', text: '#f0eade',
        seal: '#c25a3c', hairline: '#9a9284',
      },
    }

    function prng(seed) {
      let state = seed >>> 0
      return function next() {
        state ^= state << 13; state >>>= 0
        state ^= state >> 17
        state ^= state << 5; state >>>= 0
        return state / 4294967296
      }
    }

    /**
     * A mountain peak: a sharp summit with concave flanks, which is the shape a
     * 山水 painter draws. `skew` leans the summit, so a range does not look mirrored.
     */
    function peak(cx, baseY, width, height, skew) {
      const half = width / 2
      const tipX = cx + skew * half * 0.45
      const tipY = baseY - height
      // Left flank climbs inward and steepens near the summit; the right does the
      // same in reverse. Large control offsets keep the mid-slope concave.
      return `M${(cx - half).toFixed(0)} ${baseY.toFixed(0)}`
        + `C${(cx - half * 0.72).toFixed(0)} ${(baseY - height * 0.28).toFixed(0)}`
        + ` ${(tipX - half * 0.34).toFixed(0)} ${(baseY - height * 0.74).toFixed(0)}`
        + ` ${tipX.toFixed(0)} ${tipY.toFixed(0)}`
        + `C${(tipX + half * 0.36).toFixed(0)} ${(baseY - height * 0.7).toFixed(0)}`
        + ` ${(cx + half * 0.78).toFixed(0)} ${(baseY - height * 0.26).toFixed(0)}`
        + ` ${(cx + half).toFixed(0)} ${baseY.toFixed(0)}Z`
    }

    /**
     * A range as a filled silhouette spanning the whole canvas, built from peaks
     * placed to keep the middle low and the flanks high — the traditional 边角
     * composition, and what keeps the centre of a wallpaper readable.
     */
    function rangeShape(rand, baseY, height, spread) {
      const peaks = []
      // Flank peaks are tall, the middle is deliberately low.
      // Peak rhythm varies per quote: sometimes a tall massif on one side and open
      // water on the other, sometimes a continuous range. Without this every poem
      // drew the same silhouette.
      const style = Math.floor(rand() * 3)
      const slots = style === 0
        ? [[-0.1, 1.05], [0.16, 0.5], [0.36, 0.22], [0.66, 0.2], [0.86, 0.55], [1.1, 1.0]]
        : style === 1
          ? [[-0.06, 0.5], [0.2, 0.95], [0.44, 0.45], [0.7, 0.3], [0.92, 0.8], [1.12, 0.6]]
          : [[-0.12, 0.85], [0.1, 0.7], [0.34, 0.95], [0.6, 0.4], [0.84, 0.75], [1.08, 1.0]]
      for (const [t, weight] of slots) {
        const cx = 1600 * t + (rand() - 0.5) * 150
        const h = height * weight * (0.6 + rand() * 0.85)
        // Wide bases: a peak should read as a massif, not as a triangle.
        const w = (380 + rand() * 620) * spread
        peaks.push(peak(cx, baseY, w, h, rand() * 2.4 - 1.2))
      }
      // Close the band across the full width and well below the canvas edge.
      return peaks.join('') + `M-20 ${baseY.toFixed(0)}L1620 ${baseY.toFixed(0)}L1620 1100L-20 1100Z`
    }

    /** Paper grain, so a large flat wash reads as ink on paper and not as a fill. */
    function grainFilter(id, strength) {
      return `<filter id="${id}" x="0" y="0" width="100%" height="100%">`
        + `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n"/>`
        + `<feColorMatrix in="n" type="saturate" values="0"/>`
        + `<feComponentTransfer><feFuncA type="linear" slope="${strength}" intercept="0"/></feComponentTransfer>`
        + `</filter>`
    }

    /** The painting for one couplet, as SVG source, cover-scaled by the browser. */
    /** A lone boat: a low hull and a single mast, drawn as two ink strokes. */
    function boat(rand, x, y, scale, wash) {
      const s = scale
      return `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${s.toFixed(2)})" opacity=".55">`
        // Hull: a shallow crescent closed at both ends, so it floats instead of
        // reading as a line.
        + `<path d="M-42 0Q-20 13 0 13Q20 13 42 0Q20 6 0 6Q-20 6 -42 0Z" fill="${wash}"/>`
        // Mast and a slack sail, the classic 孤舟 silhouette.
        + `<path d="M0 4L-1 -40" stroke="${wash}" stroke-width="2.2" stroke-linecap="round"/>`
        + `<path d="M1 -36Q14 -26 3 -10" fill="none" stroke="${wash}" stroke-width="1.5" opacity=".7"/>`
        + `</g>`
    }

    /** Reeds at the water's edge: a tuft of curved stems with seed heads. */
    function reeds(rand, x, footY, tall, wash, density) {
      const stems = []
      const count = 5 + Math.floor(rand() * 4)
      for (let i = 0; i < count; i += 1) {
        const bx = x + (rand() - 0.5) * tall * 0.7
        const lean = (rand() - 0.5) * tall * 0.55
        const topY = footY - tall * (0.55 + rand() * 0.6)
        stems.push(`<path d="M${bx.toFixed(0)} ${footY.toFixed(0)}`
          + `Q${(bx + lean * 0.4).toFixed(0)} ${((footY + topY) / 2).toFixed(0)} ${(bx + lean).toFixed(0)} ${topY.toFixed(0)}"`
          + ` fill="none" stroke="${wash}" stroke-width="${(1.2 + rand()).toFixed(1)}" stroke-linecap="round"`
          + ` opacity="${((0.22 + rand() * 0.16) * density).toFixed(2)}"/>`)
        // A seed head: a short thickened tip.
        stems.push(`<path d="M${(bx + lean).toFixed(0)} ${topY.toFixed(0)}l${(lean * 0.12).toFixed(1)} ${(-tall * 0.06).toFixed(0)}"`
          + ` stroke="${wash}" stroke-width="2.6" stroke-linecap="round"`
          + ` opacity="${((0.2 + rand() * 0.12) * density).toFixed(2)}"/>`)
      }
      return `<g>${stems.join('')}</g>`
    }

    /**
     * Build the painting for one couplet.
     *
     * The scene is composed from the quote's mood tags, so the picture answers the
     * poem: mountains for 山, water and a boat for 水, bamboo for 竹/幽, a pavilion
     * for 寺/隐居, a bridge for 行旅, moon and pines for 月, blossom for 花, birds,
     * rain or snow. Each scene also picks one of several compositional layouts, so
     * consecutive days do not look like the same postcard recoloured.
     */
    function sceneSvg(quote, tone, density) {
      const ink = PALETTE[tone]
      const dark = tone === 'dark'
      const rand = prng(hash(quote.q + quote.a) ^ 0x9e3779b9)
      const W = 1600
      const H = 1000
      const tags = new Set(quote.m)
      const out = []
      const defs = []

      const mistColor = dark ? '#8a8f96' : ink.paper
      const wash = dark ? ink.ridge : ink.wash

      defs.push(`<linearGradient id="paper" x1="0" y1="0" x2=".2" y2="1">`
        + `<stop offset="0" stop-color="${ink.paper}"/><stop offset="1" stop-color="${ink.edge}"/></linearGradient>`)
      defs.push(`<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">`
        + `<stop offset="0" stop-color="${mistColor}" stop-opacity="0"/>`
        + `<stop offset=".5" stop-color="${mistColor}" stop-opacity="${(dark ? 0.3 : 0.85).toFixed(2)}"/>`
        + `<stop offset="1" stop-color="${mistColor}" stop-opacity="0"/></linearGradient>`)
      defs.push(`<radialGradient id="moon"><stop offset="0" stop-color="${ink.wash}" stop-opacity=".28"/>`
        + `<stop offset=".45" stop-color="${ink.wash}" stop-opacity=".1"/>`
        + `<stop offset="1" stop-color="${ink.wash}" stop-opacity="0"/></radialGradient>`)
      defs.push(`<linearGradient id="moonlight" x1="0" y1="0" x2="0" y2="1">`
        + `<stop offset="0" stop-color="#3d424b" stop-opacity="0"/>`
        + `<stop offset=".45" stop-color="#3d424b" stop-opacity="${(0.5 * density).toFixed(2)}"/>`
        + `<stop offset="1" stop-color="#3d424b" stop-opacity="0"/></linearGradient>`)
      // A vertical falloff for the water plane, so the shore has no hard seam.
      defs.push(`<linearGradient id="pool" x1="0" y1="0" x2="0" y2="1">`
        + `<stop offset="0" stop-color="${wash}" stop-opacity="${((dark ? 0.1 : 0.06) * density).toFixed(3)}"/>`
        + `<stop offset="1" stop-color="${wash}" stop-opacity="0"/></linearGradient>`)
      defs.push(grainFilter('grain', dark ? 0.1 : 0.09))
      defs.push(`<filter id="soft"><feGaussianBlur stdDeviation="3.4"/></filter>`,
        `<filter id="softer"><feGaussianBlur stdDeviation="7"/></filter>`)

      out.push(`<rect width="${W}" height="${H}" fill="url(#paper)"/>`)

      if (dark) {
        out.push(`<rect y="${(H * 0.26).toFixed(0)}" width="${W}" height="${(H * 0.66).toFixed(0)}"`
          + ` fill="url(#moonlight)"/>`)
      }

      // --- moon ---------------------------------------------------------
      if (tags.has('moon')) {
        const moonX = W * (0.1 + rand() * 0.24)
        const moonY = H * (0.1 + rand() * 0.12)
        if (dark) {
          out.push(`<circle cx="${moonX.toFixed(0)}" cy="${moonY.toFixed(0)}" r="46"`
            + ` fill="#f2ede1" opacity="${(0.5 * density).toFixed(2)}"/>`)
        }
        out.push(`<circle cx="${moonX.toFixed(0)}" cy="${moonY.toFixed(0)}" r="230" fill="url(#moon)"/>`)
      }

      // --- compositional layout ----------------------------------------
      // 0: shallow range, open sky (湖 / 江). 1: tall massif one side, void the other
      // (山). 2: layered depth with heavy mist (rain / seclusion). 3: low bank with a
      // wide water plane (travel / 舟).
      const layout = tags.has('water') && !tags.has('mountain') ? (rand() < 0.5 ? 0 : 3)
        : tags.has('mountain') ? (rand() < 0.55 ? 1 : 2)
          : (tags.has('rain') || tags.has('seclusion') ? 2 : (rand() < 0.5 ? 0 : 1))

      const horizon = H * (layout === 1 ? 0.68 : layout === 3 ? 0.55 : 0.6 + rand() * 0.12)
      const far = { base: horizon, height: H * (layout === 1 ? 0.42 : 0.26 + rand() * 0.2), opacity: dark ? 0.55 : 0.085, blur: 'softer' }
      const mid = { base: horizon + H * (0.08 + rand() * 0.08), height: H * (layout === 2 ? 0.5 : 0.3 + rand() * 0.2), opacity: dark ? 0.75 : 0.14, blur: 'soft' }
      const near = { base: H * (layout === 3 ? 1.04 : 0.95 + rand() * 0.05), height: H * (0.18 + rand() * 0.2), opacity: dark ? 0.95 : 0.22, blur: 'soft' }

      // 皴 texture: short strokes laid along each ridge's crest and slope. This is
      // what separates a wash from a flat silhouette, and it needs no motif that
      // could read as a doodle at wallpaper scale.
      const texturePass = (pathD, baseY, height, strength) => {
        const marks = []
        const count = Math.round(40 * strength)
        for (let i = 0; i < count; i += 1) {
          const x = rand() * W
          const t = rand()
          const y = baseY - height * Math.pow(t, 1.6)
          const len = height * (0.05 + rand() * 0.14)
          const drift = (rand() - 0.5) * 22
          marks.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)}l${drift.toFixed(1)} ${len.toFixed(1)}"/>`)
        }
        // Clip to the ridge so no stroke escapes into the sky.
        return marks.join('')
      }

      out.push(`<g filter="url(#${far.blur})"><path d="${rangeShape(rand, far.base, far.height, 1.25)}"`
        + ` fill="${wash}" opacity="${(far.opacity * density).toFixed(3)}"/></g>`)
      out.push(`<rect y="${(far.base - H * 0.1).toFixed(0)}" width="${W}" height="${(H * 0.18).toFixed(0)}" fill="url(#mist)"/>`)

      const midD = rangeShape(rand, mid.base, mid.height, 1.05)
      out.push(`<clipPath id="midClip"><path d="${midD}"/></clipPath>`)
      out.push(`<g filter="url(#${mid.blur})"><path d="${midD}" fill="${wash}"`
        + ` opacity="${(mid.opacity * density).toFixed(3)}"/>`
        + `<g clip-path="url(#midClip)" fill="none" stroke="${wash}" stroke-width="1.3"`
        + ` opacity="${(0.1 * density).toFixed(3)}">${texturePass(midD, mid.base, mid.height, 1)}</g></g>`)
      if (layout !== 3) {
        out.push(`<rect y="${(mid.base - H * 0.06).toFixed(0)}" width="${W}" height="${(H * 0.14).toFixed(0)}" fill="url(#mist)"/>`)
      }

      const nearD = rangeShape(rand, near.base, near.height, 0.95)
      out.push(`<clipPath id="nearClip"><path d="${nearD}"/></clipPath>`)
      out.push(`<g filter="url(#${near.blur})"><path d="${nearD}" fill="${wash}"`
        + ` opacity="${(near.opacity * density).toFixed(3)}"/>`
        + `<g clip-path="url(#nearClip)" fill="none" stroke="${wash}" stroke-width="1.6"`
        + ` opacity="${(0.12 * density).toFixed(3)}">${texturePass(nearD, near.base, near.height, 1.4)}</g></g>`)

      // Reflection: the mid range mirrored just below the waterline, clipped to the
      // water so it cannot show above the shore.
      if (tags.has('water')) {
        const shoreY = horizon + H * 0.2
        out.push(`<clipPath id="poolClip"><rect x="0" y="${shoreY.toFixed(0)}"`
          + ` width="${W}" height="${(H - shoreY).toFixed(0)}"/></clipPath>`)
        out.push(`<g clip-path="url(#poolClip)"><g transform="translate(0 ${(shoreY * 2).toFixed(0)}) scale(1 -1)"`
          + ` filter="url(#softer)" opacity="${(0.1 * density).toFixed(3)}">`
          + `<path d="${midD}" fill="${wash}"/></g></g>`)
      }

      // --- water --------------------------------------------------------
      if (tags.has('water')) {
        out.push(`<rect y="${(horizon + H * 0.14).toFixed(0)}" width="${W}"`
          + ` height="${(H - horizon).toFixed(0)}" fill="url(#pool)"/>`)
        const ripples = []
        for (let i = 0; i < 18; i += 1) {
          const x = rand() * W
          const y = horizon + H * (0.2 + rand() * 0.26)
          const len = 70 + rand() * 240
          ripples.push(`<path d="M${x.toFixed(0)} ${y.toFixed(0)}q${(len / 2).toFixed(0)} ${(-2 - rand() * 3).toFixed(0)} ${len.toFixed(0)} 0"/>`)
        }
        out.push(`<g fill="none" stroke="${wash}" stroke-width="1.1" stroke-linecap="round"`
          + ` opacity="${((dark ? 0.12 : 0.1) * density).toFixed(3)}">${ripples.join('')}</g>`)

        // A boat sits on the water line, off-centre: 孤舟 is the classic motif.
        if (tags.has('journey') || tags.has('water') || tags.has('seclusion')) {
          const bx = rand() < 0.5 ? W * (0.08 + rand() * 0.16) : W * (0.74 + rand() * 0.16)
          out.push(boat(rand, bx, horizon + H * (0.2 + rand() * 0.06), 0.75 + rand() * 0.45, wash))
        }
        // Reeds framing the near water, on the opposite side to the boat.
        if (rand() < 0.7) {
          const leftReeds = rand() < 0.5
          out.push(reeds(rand, leftReeds ? W * 0.05 : W * 0.94, H * 1.01,
            H * (0.16 + rand() * 0.1), wash, density))
        }
      }


      // --- blossom ------------------------------------------------------
      if (tags.has('flower') || tags.has('spring')) {
        const specks = []
        for (let i = 0; i < 34; i += 1) {
          specks.push(`<circle cx="${(rand() * W).toFixed(0)}" cy="${(H * (0.08 + rand() * 0.62)).toFixed(0)}"`
            + ` r="${(1.1 + rand() * 2.4).toFixed(1)}" fill="${ink.seal}"`
            + ` opacity="${((0.1 + rand() * 0.13) * density).toFixed(3)}"/>`)
        }
        out.push(specks.join(''))
      }

      // --- birds --------------------------------------------------------
      if (tags.has('bird')) {
        const birds = []
        const count = 3 + Math.floor(rand() * 5)
        const flockX = tags.has('sunset') ? 0.5 : 0.5
        for (let i = 0; i < count; i += 1) {
          const bx = W * (flockX + (rand() - 0.5) * 0.34)
          const by = H * (0.1 + rand() * 0.24)
          const s = 5 + rand() * 7
          const wing = (dir) => `M${(bx + dir * s * 2).toFixed(0)} ${by.toFixed(0)}`
            + `q${(-dir * s).toFixed(1)} ${(-s * 0.85).toFixed(1)} ${(-dir * s * 2).toFixed(1)} 0`
          birds.push(`<path d="${wing(-1)}${wing(1)}"/>`)
        }
        out.push(`<g fill="none" stroke="${ink.stroke}" stroke-width="2" stroke-linecap="round"`
          + ` opacity="${((dark ? 0.5 : 0.4) * density).toFixed(2)}">${birds.join('')}</g>`)
      }

      // --- weather ------------------------------------------------------
      if (tags.has('rain') || tags.has('snow') || tags.has('wind')) {
        const count = tags.has('snow') ? 110 : tags.has('rain') ? 80 : 38
        const marks = []
        for (let i = 0; i < count; i += 1) {
          const x = (rand() * W).toFixed(0)
          const y = (rand() * H).toFixed(0)
          marks.push(tags.has('rain')
            ? `<path d="M${x} ${y}l-2.5 10"/>`
            : `<circle cx="${x}" cy="${y}" r="${(0.7 + rand() * 1.6).toFixed(1)}"/>`)
        }
        out.push(tags.has('rain')
          ? `<g fill="none" stroke="${ink.stroke}" stroke-width="1" stroke-linecap="round"`
            + ` opacity="${(0.12 * density).toFixed(2)}">${marks.join('')}</g>`
          : `<g fill="${ink.stroke}" opacity="${((dark ? 0.22 : 0.18) * density).toFixed(2)}">${marks.join('')}</g>`)
      }

      // --- a seal-coloured sun low on the horizon for 夕阳 ---------------
      if (tags.has('sunset') && !tags.has('moon')) {
        out.push(`<circle cx="${(W * (0.66 + rand() * 0.2)).toFixed(0)}" cy="${(horizon - H * 0.02).toFixed(0)}"`
          + ` r="${(34 + rand() * 20).toFixed(0)}" fill="${ink.seal}"`
          + ` opacity="${(0.16 * density).toFixed(2)}" filter="url(#soft)"/>`)
      }

      // Grain over everything: the paper tooth that makes a flat wash read as ink.
      out.push(`<rect width="${W}" height="${H}" filter="url(#grain)" opacity=".55"/>`)
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"`
        + ` preserveAspectRatio="xMidYMid slice"><defs>${defs.join('')}</defs>${out.join('')}</svg>`
    }

    function svgUrl(svg) {
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    }

    /* ================================================================== *
     * Layout measurement
     * ================================================================== */

    function rectOf(element) {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return rect.width > 4 && rect.height > 4 ? rect : null
    }

    function firstRect(selectors) {
      for (const selector of selectors) {
        const rect = rectOf(document.querySelector(selector))
        if (rect) return rect
      }
      return null
    }

    /**
     * The horizontal band the conversation actually reads in. The composer card is
     * the most reliable witness: it is centred at the transcript's reading width in
     * every phase, including the empty hero state.
     */
    function contentBand(viewport) {
      const composer = firstRect([
        '[data-slot="conversation.composer.bar"] > *',
        '[data-slot="conversation.composer.bar"]',
      ])
      const editor = firstRect(['[contenteditable="true"]', 'textarea'])
      const anchor = composer || editor
      if (!anchor) {
        const half = Math.min(viewport.w * 0.31, 420)
        return { left: viewport.w / 2 - half, right: viewport.w / 2 + half }
      }
      // A textarea is narrower than its card; widen it to the card's reading width.
      const pad = composer ? 8 : 48
      return {
        left: Math.max(0, anchor.left - pad),
        right: Math.min(viewport.w, anchor.right + pad),
      }
    }

    function inset() {
      const darwin = document.documentElement.dataset.platform === 'darwin'
      return { top: darwin ? 52 : 34, side: 26, bottom: 26 }
    }

    const INSET = inset()

    /* ================================================================== *
     * Verse
     * ================================================================== */

    /** The two clauses, without trailing punctuation (it is re-added where needed). */
    function clauses(quote) {
      return quote.q
        .replace(/[。.]$/, '')
        .split('，')
        .map((clause) => clause.replace(/[，,。.]$/, ''))
        .filter(Boolean)
    }

    function Verse({ quote, vertical, stroke, tone, settings, align, roomHeight }) {
      const ink = PALETTE[tone]
      const parts = clauses(quote)
      const family = fontFamily(settings.font)
      // A tight halo lifts the stroke off the wash. Keep the blur radius small: a
      // wide halo smears a thin brush stroke into grey and destroys the texture
      // that makes the calligraphy worth looking at.
      const halo = tone === 'light'
        ? '0 0 3px rgba(248,244,236,.95), 0 0 9px rgba(248,244,236,.75)'
        : '0 0 3px rgba(9,10,14,.95), 0 0 10px rgba(9,10,14,.8)'

      const column = (text, index) => h('p', {
        key: index,
        style: {
          margin: 0,
          fontFamily: family,
          fontSize: `${stroke}px`,
          lineHeight: 1.22,
          letterSpacing: '0.07em',
          color: ink.text,
          textShadow: halo,
          whiteSpace: 'nowrap',
          writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
          textAlign: vertical ? 'start' : index === 0 ? 'end' : 'start',
        },
      }, text)

      // Vertical couplets read right to left, so the first clause is the right
      // column and the 落款 takes one more column to its left — the way a scroll is
      // signed. Horizontal couplets sign underneath, right-aligned.
      const ordered = vertical ? parts.slice().reverse() : parts
      const body = h('div', {
        key: 'body',
        style: {
          display: 'flex',
          flexDirection: vertical ? 'row' : 'column',
          gap: vertical ? stroke * 0.42 : stroke * 0.16,
          alignItems: vertical ? 'flex-start' : 'flex-end',
        },
      }, ordered.map(column))

      // Attribution. A quote has to name where it comes from — dynasty, poet and
      // poem — or a reader cannot look it up. The title travels in 书名号 the way
      // it would be set in print; the stamp is fixed artwork now, so it can no
      // longer carry the title itself.
      const metaText = `${quote.d} · ${quote.a}《${quote.t}》`
      const signFont = '-apple-system, "PingFang SC", "Songti SC", "Kaiti SC", serif'

      // A 15-character title is not unusual (丽正殿赐宴同勒天前烟年四韵应制), and set
      // vertically it becomes a 22-character column. Sizing the signature from the
      // verse alone overflowed the window on a short viewport, so it is capped by
      // the height actually available, down to a legible floor.
      const metaChars = Math.max(1, [...metaText].length)
      const metaFit = Math.floor(roomHeight / (metaChars * 1.5))
      const metaFontSize = clampNumber(
        Math.min(Math.round(stroke * 0.3), metaFit), 9, 20)

      const meta = settings.showSource ? metaText : null

      if (vertical) {
        const metaCol = meta ? h('div', {
          key: 'meta',
          style: {
            margin: 0,
            fontFamily: signFont,
            fontSize: `${metaFontSize}px`,
            letterSpacing: '0.16em',
            lineHeight: 1.5,
            color: ink.hairline,
            textShadow: halo,
            whiteSpace: 'nowrap',
            writingMode: 'vertical-rl',
            // The floor above can still be too tall for an extreme case; wrapping
            // into a second column is better than running off the window.
            maxHeight: roomHeight,
            overflow: 'hidden',
          },
        }, meta) : null

        return h('div', {
          style: {
            display: 'flex',
            // Columns run right to left: verse, then the signature, then the stamp.
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: Math.round(stroke * 0.34),
          },
        }, [body, h('div', {
          key: 'sign',
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: Math.round(stroke * 0.22),
          },
        }, metaCol ? [metaCol] : [])])
      }

      return h('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
      }, [
        body,
        h('div', {
          key: 'sign',
          style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 },
        }, [
          meta ? h('div', {
            key: 'm',
            style: {
              margin: 0,
              fontFamily: signFont,
              fontSize: `${metaFontSize}px`,
              letterSpacing: '0.13em',
              color: ink.hairline,
              textShadow: halo,
              whiteSpace: 'nowrap',
            },
          }, meta) : null,
          seal,
        ].filter(Boolean)),
      ])
    }

    /* ================================================================== *
     * Fixed seal artwork
     * ================================================================== */

    /**
     * One stamped seal, drawn once and never changed by the poem.
     *
     * Earlier versions set the poem's title inside the stamp, which forced the
     * glyphs to come from whatever font the machine had — so the same stamp read as
     * 楷体 or 宋体 depending on the machine, and no free seal face covers the poetry
     * corpus. A fixed inscription removes that whole problem: the stamp is a piece
     * of artwork, so it looks the same everywhere and needs no font at all.
     *
     * The art is the user's own reference — a Qin imperial seal in 鸟虫篆 — with its
     * watermark removed, its clipped margin rebuilt, and the border re-cut by hand
     * so it reads as a rubbed stone stamp: straight sides, a ragged inner contour,
     * chipped corners, dry-brush skips and cinnabar grain, rather than a clean
     * vector rectangle.
     */
    function sealStamp({ shape, style, size, dark }) {
      const side = Math.max(30, Math.round(size))
      // 朱文 is the lighter variant: the same artwork, softened.
      const opacity = style === 'yang' ? 0.82 : 1
      const href = shape === 'round' ? SEAL_ART.round : SEAL_ART.square

      // The artwork is a fixed, saturated cinnabar. On the night paper it would
      // read as dried brown, so it is lifted instead of recoloured — the grain and
      // the chips survive, which a flat colour replacement would destroy.
      const filter = dark
        ? ' filter="brightness(1.45) saturate(1.05)"'
        : ''

      // The artwork already carries its own border, so there is no clip and no
      // drawn ring: either shape is simply the image at the requested size.
      const image = `<image href="${href}" x="0" y="0" width="${side}" height="${side}"`
        + ` preserveAspectRatio="xMidYMid meet" opacity="${opacity}"${filter}/>`

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"`
        + ` viewBox="0 0 ${side} ${side}" style="display:block">`
        + `${image}</svg>`

      return sealFallbackSvg(svg)
    }

    /** Wrap the stamp markup so it renders as inline SVG inside the verse block. */
    function sealFallbackSvg(svg) {
      return h('span', {
        'aria-hidden': true,
        style: { display: 'inline-block', lineHeight: 0, flex: 'none', opacity: 0.92 },
        dangerouslySetInnerHTML: { __html: svg },
      })
    }

    /* ================================================================== *
     * Controls
     * ================================================================== */

    const GLYPH = {
      prev: 'M19 12H6m5.5-5.5L6 12l5.5 5.5',
      next: 'M5 12h13m-5.5-5.5L18 12l-5.5 5.5',
      close: 'M6 6l12 12M18 6L6 18',
      gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
        + 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1'
        + 'a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1'
        + 'a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1'
        + 'a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1'
        + 'a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1'
        + 'a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1'
        + 'a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1'
        + 'a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1'
        + 'a1.7 1.7 0 0 0-1.5 1Z',
    }

    function Glyph({ path }) {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
        style: { display: 'block' },
      }, h('path', {
        d: path, stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    const chipStyle = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      height: 26, padding: '0 8px', borderRadius: 7, cursor: 'pointer',
      fontSize: 11, fontFamily: 'inherit', lineHeight: 1,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-secondary)',
    }

    function Toggle({ label, hint, checked, onChange }) {
      return h('label', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, margin: '10px 0 0', cursor: 'pointer',
        },
      }, [
        h('span', { key: 'a', style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } }, [
          h('span', { key: 'l', style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } }, label),
          hint ? h('span', {
            key: 'h',
            style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', opacity: 0.8 },
          }, hint) : null,
        ]),
        h('input', {
          key: 'i', type: 'checkbox', checked,
          onChange: (event) => onChange(event.target.checked),
          style: {
            width: 15, height: 15, margin: 0, flex: 'none', cursor: 'pointer',
            accentColor: 'var(--dsw-alias-brand-primary)',
          },
        }),
      ])
    }

    function Segmented({ value, options, onChange }) {
      return h('div', {
        role: 'group',
        style: {
          display: 'flex', gap: 3, padding: 3, borderRadius: 8,
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-border-l1)',
        },
      }, options.map((option) => {
        const active = option.value === value
        return h('button', {
          key: String(option.value),
          type: 'button',
          'aria-pressed': active,
          onClick: () => onChange(option.value),
          style: {
            flex: 1, minWidth: 0, padding: '5px 4px', fontSize: 11, fontFamily: 'inherit',
            cursor: 'pointer', borderRadius: 6, border: '1px solid transparent',
            background: active ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
            color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            boxShadow: active ? '0 1px 2px rgba(0,0,0,.14)' : 'none',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, option.label)
      }))
    }

    function Field({ title, children }) {
      return h('div', { style: { marginTop: 12 } }, [
        h('div', {
          key: 't',
          style: {
            fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase',
            color: 'var(--dsw-alias-label-secondary)', opacity: 0.7, marginBottom: 6,
          },
        }, title),
        h('div', { key: 'b' }, children),
      ])
    }

    /* ================================================================== *
     * The wallpaper
     * ================================================================== */

    function InkWash() {
      const [settings, setSettings] = React.useState(readSettings)
      const [open, setOpen] = React.useState(false)
      const [darkApp, setDarkApp] = React.useState(
        () => document.body.hasAttribute('data-ds-dark-theme'),
      )
      const [viewport, setViewport] = React.useState(
        () => ({ w: window.innerWidth, h: window.innerHeight }),
      )
      const [band, setBand] = React.useState(() => contentBand({
        w: window.innerWidth, h: window.innerHeight,
      }))
      const [hasBrushFace] = React.useState(brushFaceAvailable)
      // The control row stays out of sight until the pointer reaches it.
      const [controlsShown, setControlsShown] = React.useState(false)
      // Live size of the verse block, used to clamp a dragged block to the viewport.
      // A ref (not state) so measuring does not re-render on every frame.
      const measuredRef = React.useRef(null)
      const blockRef = React.useRef(null)
      const [, forceMeasure] = React.useState(0)

      const update = React.useCallback((patch) => {
        setSettings((current) => {
          const next = normalize({ ...current, ...patch })
          writeSettings(next)
          return next
        })
      }, [])

      // Follow viewport size, the app's light/dark switch, and layout shifts that
      // move the reading band (sidebar collapse, docked rightbar, window resize).
      React.useEffect(() => {
        const remeasure = () => {
          const size = { w: window.innerWidth, h: window.innerHeight }
          setViewport(size)
          setBand(contentBand(size))
        }
        window.addEventListener('resize', remeasure)
        const observer = new MutationObserver(() => {
          setDarkApp(document.body.hasAttribute('data-ds-dark-theme'))
          remeasure()
        })
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-ds-dark-theme', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'],
        })
        // The frame owns the column geometry; watch it too, then settle once.
        const frame = document.querySelector('[data-shell-overlay]')?.parentElement
        const frameObserver = frame ? new MutationObserver(remeasure) : null
        if (frame && frameObserver) {
          frameObserver.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed'] })
        }
        const settle = window.setTimeout(remeasure, 250)
        return () => {
          window.removeEventListener('resize', remeasure)
          observer.disconnect()
          frameObserver?.disconnect()
          window.clearTimeout(settle)
        }
      }, [])

      // Wheel over the stamp resizes it. Installed as a real (non-passive) listener
      // because React's own wheel handler cannot call preventDefault.
      React.useEffect(() => {
        const node = sealNodeRef.current
        if (!node) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          setSettings((current) => {
            const next = normalize({
              ...current,
              sealScale: Math.min(3, Math.max(0.5, current.sealScale * (event.deltaY > 0 ? 0.92 : 1.08))),
            })
            writeSettings(next)
            return next
          })
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      })

      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      // Measure the rendered block. Runs after layout, and again whenever something
      // that changes its size changes: the quote, the font, the scale, the shape of
      // the seal, or the viewport.
      React.useEffect(() => {
        const node = blockRef.current
        if (!node) return
        const rect = node.getBoundingClientRect()
        const previous = measuredRef.current
        if (!previous
          || Math.abs(previous.w - rect.width) > 0.5
          || Math.abs(previous.h - rect.height) > 0.5) {
          measuredRef.current = { w: rect.width, h: rect.height }
          // Re-render once so the clamp can use the fresh size.
          forceMeasure((value) => value + 1)
        }
      })

      if (!settings.enabled) return null

      const today = dayNumber(new Date())
      const pinned = settings.offset !== null && settings.pinnedDay === today
      const index = pinned ? today + settings.offset : today
      const quote = pickQuote(index)
      // Paper tone is a wallpaper property, not an app-theme mirror: ink wash reads
      // as ink wash on paper. `ink` may force the night paper for users who want it;
      // `auto` keeps the paper when the app is light and the night when it is dark.
      const tone = settings.ink === 'light' || settings.ink === 'dark'
        ? settings.ink
        : (darkApp ? 'dark' : 'light')
      const ink = PALETTE[tone]

      // --- geometry -----------------------------------------------------
      // A docked right rail sits exactly where the right gutter would be. When one
      // is open, the right side is no longer free space regardless of its width.
      const rightRail = document.querySelector('[data-rightbar-col]')
      const railRect = rightRail instanceof HTMLElement ? rightRail.getBoundingClientRect() : null
      const railOpen = railRect !== null && railRect.width > 40 && railRect.left < viewport.w - 24
      const rightGutter = railOpen ? 0 : viewport.w - band.right
      const leftGutter = band.left
      const side = settings.side === 'auto'
        ? (rightGutter >= leftGutter ? 'right' : 'left')
        // An explicit side is honoured unless that side is occupied by the rail.
        : (settings.side === 'right' && railOpen ? 'left' : settings.side)
      const gutter = side === 'right' ? rightGutter : leftGutter

      const parts = clauses(quote)
      const longest = Math.max(4, ...parts.map((clause) => clause.length))
      const roomHeight = viewport.h - INSET.top - INSET.bottom - 90

      // A vertical couplet is two narrow columns, so it fits a side gutter almost
      // always. Horizontal needs the full clause width, which only a wide window can
      // spare. An explicit preference is honoured when it fits; when it does not, the
      // verse switches to the form that does instead of covering the transcript.
      const verticalStroke = clampNumber(
        Math.round(Math.min(roomHeight / longest * 0.82, (gutter - 18) / 2.55)), 15, 46)
      const horizontalStroke = clampNumber(
        Math.round(Math.min(roomHeight / 3.2, 34, (gutter - 14) / (longest * 1.06))), 12, 34)
      const fitsVertical = gutter >= verticalStroke * 2.55 + 10
      const fitsHorizontal = gutter >= horizontalStroke * longest * 1.06 + 10

      // `null` means "choose for me": vertical reads best in a side gutter.
      const orientation = settings.vertical === null
        ? (fitsVertical || !fitsHorizontal)
        : (settings.vertical ? fitsVertical : fitsHorizontal)

      const stroke = orientation ? verticalStroke : horizontalStroke
      const verseWidth = orientation ? verticalStroke * 2.55 : horizontalStroke * longest * 1.06
      const anchorSide = side
      const offsetSide = gutter >= verseWidth + 10
        ? Math.max(24, Math.round(gutter * 0.28))
        : 18
      // Sit just below the shell header, which is the first band that is reliably
      // empty in every conversation state.
      const headerRoom = 78
      const top = INSET.top + Math.round(headerRoom * 0.45)

      // Free placement: once the verse has been dragged, its stored fraction wins
      // over the automatic gutter. The box is anchored by its top-left corner so a
      // later quote — a different number of columns — grows in the same direction,
      // at the same size, instead of re-centring itself.
      const freeX = settings.placeX !== null && settings.placeY !== null
      const sizePx = Math.round(stroke * settings.scale)
      // The stamp is fixed artwork: drawn once, independent of the poem, then placed
      // and scaled on its own so it can sit in a margin anywhere.
      const sealSize = Math.round(sizePx * (settings.sealScale || 1.15))
      const sealArt = sealStamp({
        shape: settings.sealShape,
        style: settings.sealStyle,
        size: sealSize,
        dark: tone === 'dark',
      })
      // The clamp must use the block's REAL size. It previously used a formula
      // (about nine character widths wide) that was nearly three times wider than
      // the rendered verse, which left an invisible wall well short of every edge.
      // `measured` is filled by a layout effect below; until then the previous value
      // is reused so the block does not jump on the first frame.
      // Before the first measurement the block's size is unknown. Clamping with a
      // guess is what made a saved bottom-left position jump to the right after a
      // reload: the guess was far too wide, so the left coordinate was clamped up.
      // Until a real size exists, place from the stored fraction and clamp next frame.
      const measured = measuredRef.current
      const known = measured !== null
      const blockW = known ? measured.w : 0
      const blockH = known ? measured.h : 0
      const anchor = freeX
        ? {
            position: 'fixed',
            left: known
              ? Math.max(0, Math.min(viewport.w - Math.min(blockW, viewport.w),
                Math.round(settings.placeX * viewport.w)))
              : Math.round(settings.placeX * viewport.w),
            top: known
              ? Math.max(0, Math.min(viewport.h - Math.min(blockH, viewport.h),
                Math.round(settings.placeY * viewport.h)))
              : Math.round(settings.placeY * viewport.h),
            maxWidth: Math.max(160, Math.min(viewport.w * 0.6, sizePx * (longest + 3))),
            pointerEvents: 'none',
            zIndex: 1,
          }
        : {
            position: 'fixed',
            top,
            ...(anchorSide === 'right' ? { right: offsetSide } : { left: offsetSide }),
            maxWidth: Math.max(140, Math.min(verseWidth + 12, viewport.w * 0.5)),
            pointerEvents: 'none',
            zIndex: 1,
          }

      // The verse box as concrete numbers. The anchor style may be expressed with
      // `right` or `left`, so resolve it once here; the settings panel opens beside
      // this box and must not overlap it.
      const anchorWidth = known
        ? Math.round(Math.min(blockW, anchor.maxWidth || blockW))
        : Math.round(anchor.maxWidth || 160)
      const anchorRect = freeX
        ? { left: anchor.left, top: anchor.top }
        : {
            left: anchorSide === 'right'
              ? Math.max(0, viewport.w - offsetSide - anchorWidth)
              : offsetSide,
            top,
          }

      const painting = React.useMemo(
        () => svgUrl(sceneSvg(quote, tone, settings.density)),
        [quote.q, quote.a, tone, settings.density],
      )

      const veil = tone === 'dark' ? 'rgba(13,15,19,' : 'rgba(248,245,238,'
      // Painting geometry: the scene is cover-scaled on the page canvas. Carrying it
      // on `body` itself, rather than on a negative-z-index ::before, is what keeps
      // it behind every shell column while still painting the canvas: a negative
      // layer can fall behind the root canvas and disappear.
      // Layers, bottom to top:
      //   1. the painting          — body, cover-scaled, fixed to the window
      //   2. the paper veil        — a second body layer *above* the painting, dense
      //                              behind the transcript and clear in the side
      //                              gutters. It has to be a background layer, not a
      //                              ::before: a negative-z pseudo element paints
      //                              behind the body's own background and is hidden.
      //   3. the shell surfaces    — made transparent through one base token below,
      //                              so they stop double-painting over the scene.
      const veilLayer = `linear-gradient(90deg,`
        + ` ${veil}0) calc(${band.left.toFixed(0)}px - 170px),`
        + ` ${veil}0.9) ${band.left.toFixed(0)}px,`
        + ` ${veil}0.9) ${band.right.toFixed(0)}px,`
        + ` ${veil}0) calc(${band.right.toFixed(0)}px + 170px))`

      const styles = `
/* The three shipped brush faces, subset to exactly this plugin's character set.
   Declared here as well as exported from the module so they exist before the first
   verse renders. */
${FONT_FACE_RULES}
html.dsh-ipw-active, body.dsh-ipw-active { background-color: transparent !important; }
html.dsh-ipw-active body {
  /* Painter order: the veil gradient is listed first so it paints on top. */
  background-image: ${veilLayer}, ${painting} !important;
  background-color: ${ink.paper} !important;
  background-size: 100% 100%, cover !important;
  background-position: center center, center center !important;
  background-repeat: no-repeat, no-repeat !important;
  background-attachment: fixed, fixed !important;
}
/* One transparent base token stops every shell column double-painting over the
   painting. Cards, menus and the composer keep their own layer-1/2 fills. */
body.dsh-ipw-active {
  --dsw-alias-bg-base: transparent !important;
  --dsw-specific-sidebar-fill: ${veil}0.42) !important;
}
body.dsh-ipw-active[data-ds-dark-theme] {
  --dsw-specific-sidebar-fill: ${veil}0.5) !important;
}`

      // --- free placement -------------------------------------------------
      // The verse block is dragged by its body. A drag stores the block's top-left
      // as a fraction of the window, and that fraction is what every later quote
      // uses, so the position survives the daily change and a window resize.
      const dragRef = React.useRef(null)
      const sealDragRef = React.useRef(null)
      const sealNodeRef = React.useRef(null)
      const [dragging, setDragging] = React.useState(false)

      // Dragging has two traps, and both were hit:
      //   1. capturing the pointer on pointerdown retargets the gesture, so a button
      //      under the cursor never receives its click;
      //   2. listening for pointermove on the block itself loses the gesture the
      //      moment the pointer leaves it (the anchor is pointer-events: none, so the
      //      moves are delivered elsewhere).
      // So: begin on the block, then follow the gesture on `window` until pointerup.
      const DRAG_THRESHOLD = 4

      const onPointerDown = (event) => {
        if (event.button !== 0) return
        // A press that starts on a control is a click, never a drag.
        if (event.target instanceof Element && event.target.closest('button')) return

        const block = event.currentTarget
        const rect = block.getBoundingClientRect()
        const start = {
          dx: event.clientX - rect.left,
          dy: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
        dragRef.current = start

        const onMove = (moveEvent) => {
          const live = dragRef.current
          if (live !== start) return
          const dx = moveEvent.clientX - live.startX
          const dy = moveEvent.clientY - live.startY
          if (!live.moved) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
            live.moved = true
            setDragging(true)
          }
          // Keep the whole block inside the window, using its measured size. Hard-coded
          // 60/40 margins here let the block reach the edge while dragging and then
          // snapped it back on release.
          const size = measuredRef.current
          const limitX = Math.max(0, window.innerWidth - (size ? size.w : 80))
          const limitY = Math.max(0, window.innerHeight - (size ? size.h : 80))
          const left = Math.max(0, Math.min(limitX, moveEvent.clientX - live.dx))
          const top = Math.max(0, Math.min(limitY, moveEvent.clientY - live.dy))
          update({
            placeX: left / Math.max(1, window.innerWidth),
            placeY: top / Math.max(1, window.innerHeight),
          })
        }

        const onUp = () => {
          if (dragRef.current === start) dragRef.current = null
          setDragging(false)
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          window.removeEventListener('pointercancel', onUp, true)
          // Re-measure on release: the block's height changes when the control row
          // appears, and the clamp should use the settled size.
          const node = blockRef.current
          if (node) {
            const rect = node.getBoundingClientRect()
            measuredRef.current = { w: rect.width, h: rect.height }
          }
        }

        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
        window.addEventListener('pointercancel', onUp, true)
      }

      const resetPlacement = () => update({ placeX: null, placeY: null, scale: 1 })

      const step = (delta) => update({ offset: (index + delta) - today, pinnedDay: today })
      const reset = () => update({ offset: null, pinnedDay: null })

      // --- independent seal placement -------------------------------------
      // The stamp is dragged and scaled on its own, so it can sit anywhere the poem
      // does not: a stamp belongs in a margin, not necessarily under the signature.
      const sealDragging = sealDragRef.current
      const sealDefault = {
        left: anchorSide === 'right'
          ? Math.max(8, anchorRect.left - sealSize - 14)
          : anchorRect.left + anchorWidth + 16,
        top: anchorRect.top + Math.round(stroke * 1.15) + 12,
      }
      const sealX = settings.sealX !== null ? settings.sealX : null
      const sealY = settings.sealY !== null ? settings.sealY : null
      const sealPos = sealX !== null && sealY !== null
        ? { left: Math.round(sealX * viewport.w), top: Math.round(sealY * viewport.h) }
        : sealDefault

      const sealNode = h('div', {
        key: 'seal',
        'data-dsh-ink-seal': '',
        title: '拖动可移动朱印，滚轮可缩放',
        style: {
          position: 'fixed',
          left: Math.max(0, Math.min(viewport.w - sealSize, sealPos.left)),
          top: Math.max(0, Math.min(viewport.h - sealSize, sealPos.top)),
          width: sealSize,
          height: sealSize,
          pointerEvents: 'auto',
          cursor: sealDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
          zIndex: 1,
          opacity: 0.95,
        },
        onPointerDown: (event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          const start = {
            dx: event.clientX - rect.left,
            dy: event.clientY - rect.top,
            moved: false,
          }
          sealDragRef.current = start
          const onMove = (moveEvent) => {
            if (sealDragRef.current !== start) return
            const left = Math.max(0, Math.min(window.innerWidth - sealSize, moveEvent.clientX - start.dx))
            const top = Math.max(0, Math.min(window.innerHeight - sealSize, moveEvent.clientY - start.dy))
            update({
              sealX: left / Math.max(1, window.innerWidth),
              sealY: top / Math.max(1, window.innerHeight),
            })
          }
          const onUp = () => {
            if (sealDragRef.current === start) sealDragRef.current = null
            window.removeEventListener('pointermove', onMove, true)
            window.removeEventListener('pointerup', onUp, true)
            window.removeEventListener('pointercancel', onUp, true)
          }
          window.addEventListener('pointermove', onMove, true)
          window.addEventListener('pointerup', onUp, true)
          window.addEventListener('pointercancel', onUp, true)
        },
        // React attaches wheel listeners passively, so preventDefault there is
        // ignored (and logs an error). The listener is installed directly on the
        // node instead, which allows preventing the page scroll.
        ref: (node) => {
          sealNodeRef.current = node
        },
      }, sealArt)

      return h(React.Fragment, null, [
        h('style', { key: 'css' }, styles),

        h('div', { key: 'verse', style: anchor, 'data-dsh-ink-poem': '' },
          h('div', {
            ref: blockRef,
            style: {
              pointerEvents: 'auto', display: 'inline-block',
              cursor: dragging ? 'grabbing' : 'grab',
              // A user-select guard keeps a drag from selecting the calligraphy.
              userSelect: 'none', WebkitUserSelect: 'none',
              touchAction: 'none',
            },
            onPointerDown,
            title: '拖动可移动位置',
          }, [
            h(Verse, {
              key: 'v', quote, vertical: orientation, stroke: sizePx, tone, settings,
              align: anchorSide === 'right' ? 'flex-end' : 'flex-start', roomHeight,
            }),
            h('div', {
              key: 'c',
              style: {
                display: 'flex', alignItems: 'center', gap: 5, marginTop: 12,
                justifyContent: anchorSide === 'right' ? 'flex-end' : 'flex-start',
                // The row is revealed by hovering its own invisible hit area, which
                // is why the controls sit inside it rather than fading themselves:
                // opacity alone keeps receiving pointer events, so a hover trigger
                // has to be a real box.
                position: 'relative',
              },
              onMouseEnter: () => setControlsShown(true),
              onMouseLeave: () => setControlsShown(false),
            }, [
              // The hover strip: invisible, generous, and below the chips in the
              // stacking order so it can never intercept a click on them. It only
              // has to catch the pointer on its way down from the verse.
              h('div', {
                key: 'hit',
                'aria-hidden': true,
                style: {
                  position: 'absolute',
                  top: -18,
                  right: -6,
                  bottom: -10,
                  left: -6,
                  zIndex: 0,
                },
              }),
              h('div', {
                key: 'chips',
                // Hidden until hovered or focused; `visibility` (not just opacity)
                // also keeps the chips out of the tab order while they are hidden.
                style: {
                  display: 'flex', alignItems: 'center', gap: 5,
                  justifyContent: anchorSide === 'right' ? 'flex-end' : 'flex-start',
                  position: 'relative',
                  zIndex: 1,
                  opacity: controlsShown || open ? 1 : 0,
                  visibility: controlsShown || open ? 'visible' : 'hidden',
                  transition: 'opacity .18s ease, visibility .18s ease',
                },
                onFocus: () => setControlsShown(true),
                onBlur: (event) => {
                  // Keep the row visible while focus stays inside it.
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setControlsShown(false)
                  }
                },
              }, [
                h('button', {
                  key: 'p', type: 'button', title: '上一句', 'aria-label': '上一句',
                  onClick: () => step(-1), style: { ...chipStyle, width: 26, padding: 0 },
                }, h(Glyph, { path: GLYPH.prev })),
                h('button', {
                  key: 'n', type: 'button', title: '下一句', 'aria-label': '下一句',
                  onClick: () => step(1), style: { ...chipStyle, width: 26, padding: 0 },
                }, h(Glyph, { path: GLYPH.next })),
                // The quote counter was removed at the user's request: the position
                // in the pool is bookkeeping, not something to show on a wallpaper.
                h('button', {
                  key: 'm', type: 'button', title: '壁纸设置', 'aria-label': '壁纸设置',
                  'aria-expanded': open, onClick: () => setOpen((value) => !value),
                  style: open ? { ...chipStyle, background: 'var(--dsw-alias-bg-layer-2)' } : chipStyle,
                }, h(Glyph, { path: GLYPH.gear })),
                pinned ? h('button', {
                  key: 'r', type: 'button',
                  title: '回到今天的句子（手动选择次日自动恢复）',
                  onClick: reset, style: chipStyle,
                }, '回到今日') : null,
              ].filter(Boolean)),
            ].filter(Boolean)),
          ])),
        sealNode,

        open ? h('div', {
          key: 'panel',
          role: 'dialog',
          'aria-label': '水墨诗词壁纸设置',
          style: {
            position: 'fixed',
            // Open beside the verse, on the inner side, so the panel never covers the
            // poem. When the verse has been dragged, follow it; otherwise use the
            // automatic gutter.
            // Open on the inner side of the verse so the panel never covers it.
            ...(anchorSide === 'right'
              ? { right: Math.max(12, Math.round(viewport.w - anchorRect.left + 12)) }
              : { left: Math.max(12, Math.round(anchorRect.left + anchorWidth + 12)) }),
            top: Math.max(12, Math.min(anchorRect.top, viewport.h - 430)),
            width: 272,
            maxHeight: '82vh',
            overflowY: 'auto',
            padding: 14,
            borderRadius: 12,
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-overlay)',
            boxShadow: '0 18px 48px rgba(0,0,0,.26)',
            color: 'var(--dsw-alias-label-primary)',
            fontFamily: 'inherit',
            zIndex: 2,
          },
        }, [
          h('div', {
            key: 'head',
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
          }, [
            h('span', {
              key: 't',
              style: { fontSize: 12, fontWeight: 600, letterSpacing: '0.05em' },
            }, '水墨诗词壁纸'),
            h('button', {
              key: 'x', type: 'button', 'aria-label': '关闭',
              onClick: () => setOpen(false),
              style: {
                width: 22, height: 22, padding: 0, borderRadius: 6, cursor: 'pointer',
                border: 0, background: 'transparent',
                color: 'var(--dsw-alias-label-secondary)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              },
            }, h(Glyph, { path: GLYPH.close })),
          ]),
          h(Toggle, {
            key: 'src', label: '显示出处', checked: settings.showSource,
            onChange: (value) => update({ showSource: value }),
          }),
          h(Field, { key: 'f1', title: '字体' }, h(Segmented, {
            value: settings.font,
            options: Object.entries(FONTS).map(([value, spec]) => ({ value, label: spec.label })),
            onChange: (value) => update({ font: value }),
          })),
          h(Field, { key: 'fz', title: '字号' }, h(Segmented, {
            value: settings.scale,
            options: [
              { value: 0.8, label: '小' },
              { value: 1, label: '标准' },
              { value: 1.35, label: '大' },
              { value: 1.8, label: '特大' },
            ],
            onChange: (value) => update({ scale: Number(value) }),
          })),
          h('div', {
            key: 'pos',
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 },
          }, [
            h('span', {
              key: 'l',
              style: { fontSize: 10.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', opacity: 0.85 },
            }, settings.placeX === null ? '拖动诗句可自由摆放' : '位置已固定，之后换句不变'),
            h('button', {
              key: 'b', type: 'button', onClick: resetPlacement,
              style: {
                flex: 'none', padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
                fontSize: 10.5, fontFamily: 'inherit',
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
              },
            }, '恢复自动'),
          ]),
          h(Field, { key: 'fseal', title: '朱印形状' }, h(Segmented, {
            value: settings.sealShape,
            options: [
              { value: 'square', label: '方印' },
              { value: 'round', label: '圆印' },
            ],
            onChange: (value) => update({ sealShape: value }),
          })),
          h(Field, { key: 'fstyle', title: '朱印样式' }, h(Segmented, {
            value: settings.sealStyle,
            options: [
              { value: 'yin', label: '白文' },
              { value: 'yang', label: '朱文' },
            ],
            onChange: (value) => update({ sealStyle: value }),
          })),
          h(Field, { key: 'fsealsz', title: '朱印大小' }, h(Segmented, {
            value: settings.sealScale,
            options: [
              { value: 0.85, label: '小' },
              { value: 1.15, label: '标准' },
              { value: 1.6, label: '大' },
              { value: 2.2, label: '特大' },
            ],
            onChange: (value) => update({ sealScale: Number(value) }),
          })),
          h('div', {
            key: 'sealpos',
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
          }, [
            h('span', {
              key: 'l',
              style: { fontSize: 10.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', opacity: 0.85 },
            }, '拖动朱印可移动，滚轮可缩放'),
            h('button', {
              key: 'b', type: 'button',
              onClick: () => update({ sealX: null, sealY: null, sealScale: 1.15 }),
              style: {
                flex: 'none', padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
                fontSize: 10.5, fontFamily: 'inherit',
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
              },
            }, '复位'),
          ]),
          h(Field, { key: 'f0', title: '纸色' }, h(Segmented, {
            value: settings.ink,
            options: [
              { value: 'auto', label: '跟随主题' },
              { value: 'light', label: '宣纸' },
              { value: 'dark', label: '夜山' },
            ],
            onChange: (value) => update({ ink: value }),
          })),
          h(Field, { key: 'f2', title: '墨色' }, h(Segmented, {
            value: settings.density,
            options: [
              { value: 0.6, label: '淡' },
              { value: 1, label: '适' },
              { value: 1.45, label: '浓' },
            ],
            onChange: (value) => update({ density: Number(value) }),
          })),
          h(Field, { key: 'f3', title: '排布' }, h(Segmented, {
            value: settings.vertical === null ? 'auto' : settings.vertical ? 'v' : 'h',
            options: [
              { value: 'auto', label: '自动' },
              { value: 'v', label: '竖排' },
              { value: 'h', label: '横排' },
            ],
            onChange: (value) => update({ vertical: value === 'auto' ? null : value === 'v' }),
          })),
          h(Field, { key: 'f4', title: '贴边' }, h(Segmented, {
            value: settings.side,
            options: [
              { value: 'auto', label: '自动' },
              { value: 'left', label: '左侧' },
              { value: 'right', label: '右侧' },
            ],
            onChange: (value) => update({ side: value }),
          })),
          h('p', {
            key: 'note',
            style: {
              margin: '12px 0 0', fontSize: 10.5, lineHeight: 1.7,
              color: 'var(--dsw-alias-label-secondary)', opacity: 0.82,
            },
          }, `设置即时生效并已保存在本机。每天自动换一句，手动切换次日自动恢复。`
            + `共 ${QUOTES.length} 句，取自 chinese-poetry 唐宋诗词。`),
          hasBrushFace ? null : h('p', {
            key: 'noface',
            style: {
              margin: '6px 0 0', fontSize: 10.5, lineHeight: 1.7,
              color: 'var(--dsw-alias-state-warn-primary, inherit)', opacity: 0.9,
            },
          }, '本机没有安装行楷，诗句会退回楷体；草书 / 行草 / 行书三款是随插件附带的，不受影响。'),
        ]) : null,
      ].filter(Boolean))
    }

    function clampNumber(value, min, max) {
      return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
    }

    /* ================================================================== *
     * Entry
     * ================================================================== */

    return {
      inject: ['slots'],
      apply(ctx) {
        // Fetch the shipped brush faces once, up front, so switching to one does not
        // show a fallback frame first.
        preloadFaces()

        ctx.effect(() => {
          document.body.classList.add('dsh-ipw-active')
          document.documentElement.classList.add('dsh-ipw-active')
          return () => {
            document.body.classList.remove('dsh-ipw-active')
            document.documentElement.classList.remove('dsh-ipw-active')
          }
        }, 'ink-poem-wallpaper: page canvas')

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'ink-poem-wallpaper',
          order: -100,
        }, InkWash))
      },
    }
  },
})
