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
     * Page stylesheet
     * ================================================================== */

    // The painting is a stylesheet rule on `html` / `body`, so the `<style>` node must
    // not be owned by the slot entry. A slot entry can be unmounted, re-rendered by an
    // unrelated shell change, or abdicated after a render failure while the page keeps
    // running; a `<style>` living in that subtree is removed with it, which leaves
    // `body` transparent and lets the shell's own opaque fallback paint through — the
    // wallpaper looks switched off until the plugin is reopened. One node, mounted and
    // removed by the plugin effect, keeps the paint alive exactly as long as the
    // plugin is loaded.
    const STYLE_ID = 'dsh-ipw-poem-style'

    function ensureStyleNode() {
      if (typeof document === 'undefined' || !document.head) return null
      const existing = document.getElementById(STYLE_ID)
      if (existing) return existing
      const node = document.createElement('style')
      node.id = STYLE_ID
      node.setAttribute('data-dsh-ink-poem-style', '')
      document.head.appendChild(node)
      return node
    }

    function writeStyles(css) {
      const node = ensureStyleNode()
      if (!node || node.textContent === css) return
      node.textContent = css
    }

    function removeStyleNode() {
      if (typeof document === 'undefined') return
      document.getElementById(STYLE_ID)?.remove()
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
      // A page with a turned corner: "read the whole thing".
      page: 'M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z'
        + 'M14 3v4h4M9.5 12h5M9.5 16h5',
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
     * The poem layer
     * ================================================================== */

    /**
     * Where the data comes from.
     *
     * A relative URL, so it resolves against whatever origin the app is running
     * on: `http://127.0.0.1:<port>` in a browser, `dsh-app://app` in the desktop
     * shell. The shell forwards the latter to the Host with its own credentials,
     * which is why the Client half can read the record without knowing the port.
     */
    const DATA_URL = `${FONT_BASE}/poem.json`

    /**
     * The server-rendered page for the same record.
     *
     * Used only when `DATA_URL` is not answered — a Host process started before
     * the JSON route existed still serves this one, so the reader gets the poem
     * without having to restart the app. Always relative, for the same reason as
     * `DATA_URL`, and always same-origin, so the frame is not a cross-site embed.
     */
    const PAGE_URL = `${FONT_BASE}/poem`

    /**
     * Characters ignored when looking for the couplet inside a full line.
     *
     * The pool and the corpus punctuate independently — one may carry 「，」 where
     * the other does not — so the comparison drops punctuation from both sides
     * instead of demanding an exact substring.
     */
    const LAYER_SKIP = new Set(Array.from(' \t\n\r，。、；：？！“”‘’（）【】…—·．,.;:?!"\'()[]《》'))

    function bareWithMap(text) {
      let out = ''
      const map = []
      for (let index = 0; index < text.length; index += 1) {
        if (LAYER_SKIP.has(text[index])) continue
        out += text[index]
        map.push(index)
      }
      return { text: out, map }
    }

    /**
     * Longest common subsequence of two bare strings, as an alignment.
     *
     * The pool and the corpus were edited independently, so a couplet can differ
     * from its full-text twin by a character or two — 犁/犂, 滚滚/衮衮, 忽如/忽然,
     * 洛阳城/汉阳城. Those are the corpus's own readings, not our errors, and the
     * poem on screen is the right poem; only the substring test fails. Aligning the
     * two instead of demanding equality keeps the mark on the line it belongs to.
     */
    function align(source, needle) {
      const rows = source.length + 1
      const cols = needle.length + 1
      const table = new Uint16Array(rows * cols)
      for (let row = 1; row < rows; row += 1) {
        for (let col = 1; col < cols; col += 1) {
          table[row * cols + col] = source[row - 1] === needle[col - 1]
            ? table[(row - 1) * cols + (col - 1)] + 1
            : Math.max(table[(row - 1) * cols + col], table[row * cols + (col - 1)])
        }
      }
      // Walk back from the corner, collecting the matched pairs.
      const pairs = []
      let row = source.length
      let col = needle.length
      while (row > 0 && col > 0) {
        if (source[row - 1] === needle[col - 1]) {
          pairs.push([row - 1, col - 1])
          row -= 1
          col -= 1
        } else if (table[(row - 1) * cols + col] >= table[row * cols + (col - 1)]) {
          row -= 1
        } else {
          col -= 1
        }
      }
      return pairs.reverse()
    }

    /**
     * Split one line into plain and marked runs, so the reader can see which part
     * of the poem the wallpaper is currently showing.
     *
     * Returns plain strings and `<em>` elements. An exact run wins; failing that,
     * an alignment that agrees on at least three quarters of the couplet still
     * marks the corresponding span — that is a textual variant, not a different
     * poem. Below that threshold the line comes back unmarked rather than guessed
     * at.
     */
    function markLine(line, couplet) {
      const needle = bareWithMap(couplet).text
      if (!needle) return [line]
      const source = bareWithMap(line)

      let from = source.text.indexOf(needle)
      let length = needle.length
      if (from < 0) {
        // Too short to tell a variant from a coincidence.
        if (needle.length < 8) return [line]
        const pairs = align(source.text, needle)
        if (pairs.length < needle.length * 0.75) return [line]
        from = pairs[0][0]
        length = pairs[pairs.length - 1][0] - from + 1
      }

      const start = source.map[from]
      const end = source.map[from + length - 1] + 1
      const before = line.slice(0, start)
      const marked = line.slice(start, end)
      const after = line.slice(end)
      return [
        before || null,
        h('em', { key: 'mark', style: { fontStyle: 'normal', color: SEAL_INK } }, marked),
        after || null,
      ].filter((part) => part !== null)
    }

    /**
     * The stamp red, resolved once.
     *
     * The layer paints its own paper instead of the app's surfaces — this is a
     * page of a book, not a dialog — so it cannot borrow the shell's accent.
     */
    const SEAL_INK = 'var(--dsh-ipw-seal, #a63b32)'

    const layerFont = {
      // Long prose never uses the shipped brush faces: those are subset to the
      // characters the quote pool uses, and a poem's full text runs far past that
      // subset — a brush face here would show tofu boxes mid-poem.
      serif: '"Songti SC","Source Han Serif SC","Noto Serif CJK SC",STSong,SimSun,Georgia,serif',
    }

    /**
     * The full poem, its poet and its background, as a layer above the wallpaper.
     *
     * A separate document (index.js renders one at /ink-poem-wallpaper/poem) is
     * the natural shape for long prose, but the desktop shell refuses `window.open`
     * for the `dsh-app:` scheme — the handler only passes http(s) to the system
     * browser and denies everything else — so a tab would silently do nothing
     * there. Reading the record and laying it out in the app's own tree works the
     * same in both hosts, and keeps the wallpaper's paper rather than the shell's
     * chrome.
     */
    function PoemLayer({ quote, titleFamily, onClose }) {
      const [state, setState] = React.useState({ status: 'loading', record: null })
      const closeRef = React.useRef(null)

      React.useEffect(() => {
        let alive = true
        setState({ status: 'loading', record: null })

        const params = new URLSearchParams({ a: quote.a, t: quote.t })
        fetch(`${DATA_URL}?${params.toString()}`)
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((record) => {
            if (!alive) return
            // A successful answer with no verses means the poem really is not in
            // the local library: that is a message for the reader, not a failure.
            const hasBody = record && (Array.isArray(record.p) ? record.p.length > 0 : false)
            setState(hasBody
              ? { status: 'ready', record }
              : { status: 'empty', record })
          })
          .catch(() => {
            // The JSON route is newer than the page route, so an older Host
            // process answers 404 for it while still serving the page. Rather
            // than making the reader restart the app, fall back to the page
            // itself in a frame — it renders the same records from the same
            // process, and the shell forwards the request with its credentials.
            if (alive) setState({ status: 'frame', record: null })
          })

        return () => { alive = false }
      }, [quote.a, quote.t])

      React.useEffect(() => {
        // Escape closes, and the button takes focus so the layer is dismissable
        // from the keyboard without a tab through the whole page behind it.
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
        window.addEventListener('keydown', onKey, true)
        closeRef.current?.focus()
        return () => window.removeEventListener('keydown', onKey, true)
      }, [onClose])

      const record = state.record
      // Every field is read defensively: the layer paints its heading before the
      // record arrives (and after it turns out to be missing), so `record` is null
      // for the whole loading and empty states.
      const paragraphs = record && Array.isArray(record.p) ? record.p : []
      const biography = (record && record.b) || ''
      const background = (record && record.bg) || ''
      const dynasty = (record && record.d) || ''

      const rule = '1px solid var(--dsh-alias-border-l1)'

      const section = (key, title, body) => h('section', {
        key,
        style: { marginTop: 34, paddingTop: 20, borderTop: rule },
      }, [
        h('h2', {
          key: 'h',
          style: {
            margin: '0 0 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.3em',
            textIndent: '0.3em', color: 'var(--dsw-alias-label-secondary)', opacity: 0.85,
            fontFamily: 'inherit',
          },
        }, title),
        body,
      ])

      const prose = (text, key) => h('p', {
        key,
        style: {
          margin: 0, fontSize: 14, lineHeight: 2.05, textAlign: 'justify',
          color: 'var(--dsw-alias-label-secondary)', fontFamily: layerFont.serif,
        },
      }, text)

      let body
      if (state.status === 'loading') {
        body = h('p', {
          style: {
            margin: '36px 0', fontSize: 13, color: 'var(--dsw-alias-label-secondary)',
            opacity: 0.8, fontFamily: layerFont.serif,
          },
        }, '正在读诗…')
      } else if (state.status === 'empty') {
        body = [
          h('p', {
            key: 'lead',
            style: {
              margin: '30px 0 0', fontSize: 15, lineHeight: 2, textAlign: 'center',
              color: 'var(--dsw-alias-label-primary)', fontFamily: layerFont.serif,
            },
          }, quote.q),
          h('p', {
            key: 'why',
            style: {
              margin: '22px auto 0', maxWidth: '30em', fontSize: 13, lineHeight: 2,
              textAlign: 'center', color: 'var(--dsw-alias-label-secondary)',
              opacity: 0.85, fontFamily: layerFont.serif,
            },
          }, '这首诗的完整正文、作者生平与创作背景没有收进本机的诗库，只能先给你这一联。'
            + '诗库取自 chinese-poetry，个别篇目与其版本有异文时会对不上，此处不作补写。'),
        ]
      } else if (state.status === 'frame') {
        // No chrome of its own beyond the frame: the page inside already draws
        // the heading, the poem and the two prose sections, and repeating them
        // here would read as a duplicate title.
        body = h('iframe', {
          key: 'frame',
          title: '诗的全文与背景',
          src: `${PAGE_URL}?${new URLSearchParams({ a: quote.a, t: quote.t, q: quote.q }).toString()}`,
          style: {
            display: 'block', width: '100%', height: '72vh', border: 0,
            borderRadius: 10, background: 'transparent',
          },
        })
      } else {
        body = [
          paragraphs.length > 0 ? h('div', {
            key: 'verse',
            style: { margin: '30px 0 6px', textAlign: 'center' },
          }, paragraphs.map((line, index) => h('p', {
            key: `l${index}`,
            style: {
              margin: index === paragraphs.length - 1 ? 0 : '0 0 0.55em',
              fontSize: 17, lineHeight: 2.05, letterSpacing: '0.05em',
              color: 'var(--dsw-alias-label-primary)', fontFamily: layerFont.serif,
            },
          }, markLine(line, quote.q)))) : null,
          section('bio', '作者', biography
            ? prose(biography, 'b')
            : h('p', {
              key: 'b',
              style: {
                margin: 0, fontSize: 13, lineHeight: 2, fontStyle: 'italic',
                color: 'var(--dsw-alias-label-secondary)', opacity: 0.7,
                fontFamily: layerFont.serif,
              },
            }, '本机诗库里没有这位诗人的小传。')),
          section('bg', '创作背景', background
            ? prose(background, 'g')
            : h('p', {
              key: 'g',
              style: {
                margin: 0, fontSize: 13, lineHeight: 2, fontStyle: 'italic',
                color: 'var(--dsw-alias-label-secondary)', opacity: 0.7,
                fontFamily: layerFont.serif,
              },
            }, '这首诗的创作背景暂时没有资料，此处不作推测。')),
          h('p', {
            key: 'foot',
            style: {
              margin: '30px 0 0', fontSize: 11, lineHeight: 1.9, textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', opacity: 0.6,
              fontFamily: layerFont.serif,
            },
          }, '正文、小传与背景取自 chinese-poetry（MIT）；本页由本机数据生成，不联网。'),
        ].filter(Boolean)
      }

      const framed = state.status === 'frame'

      return h('div', {
        'data-dsh-ink-poem-layer': '',
        role: 'dialog',
        'aria-modal': true,
        'aria-label': '诗的全文与背景',
        // The backdrop both dims the wallpaper and dismisses the layer: the whole
        // screen outside the sheet is a close target, which is what a reader
        // expects from a page that covers everything.
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onClose()
        },
        style: {
          position: 'fixed', inset: 0, zIndex: 4200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '3vh 20px',
          background: 'rgba(18,16,13,.42)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        },
      }, h('div', {
        // The sheet keeps the wallpaper's paper rather than the shell's surface:
        // this is a page of a book laid over the app, not a settings dialog.
        style: {
          position: 'relative', width: framed ? 'min(760px, 100%)' : 'min(720px, 100%)',
          maxHeight: '94vh',
          overflowY: 'auto', overscrollBehavior: 'contain',
          padding: framed ? '44px 18px 18px' : '52px 40px 44px', borderRadius: 14,
          border: rule,
          background: 'var(--dsw-alias-bg-overlay)',
          boxShadow: '0 28px 72px rgba(0,0,0,.34)',
          color: 'var(--dsw-alias-label-primary)',
        },
      }, [
        h('button', {
          key: 'x',
          ref: closeRef,
          type: 'button',
          'aria-label': '关闭',
          onClick: onClose,
          style: {
            position: 'absolute', top: 12, right: 12,
            width: 26, height: 26, padding: 0, borderRadius: 7, cursor: 'pointer',
            border: rule, background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-secondary)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            // Above the frame, which would otherwise paint over the button.
            zIndex: 1,
          },
        }, h(Glyph, { path: GLYPH.close })),
        // The framed page brings its own heading, so drawing ours as well would
        // read as the same title twice on one screen.
        framed ? null : h('header', {
          key: 'head',
          style: { textAlign: 'center', paddingBottom: 20, borderBottom: rule },
        }, [
          dynasty ? h('p', {
            key: 'd',
            style: {
              margin: '0 0 10px', fontSize: 11, letterSpacing: '0.4em',
              textIndent: '0.4em', color: 'var(--dsw-alias-label-secondary)', opacity: 0.8,
              fontFamily: layerFont.serif,
            },
          }, dynasty) : null,
          h('h1', {
            key: 't',
            style: {
              margin: 0, fontSize: 30, fontWeight: 400, lineHeight: 1.4,
              letterSpacing: '0.06em',
              // The title's characters are guaranteed by the font filter, which
              // rejects any quote whose title the shipped faces cannot draw — so
              // the brush face is safe here even though the body text is not.
              fontFamily: `${titleFamily},${layerFont.serif}`,
            },
          }, (record && record.t) || quote.t),
          h('p', {
            key: 'a',
            style: {
              margin: '10px 0 0', fontSize: 13, letterSpacing: '0.28em',
              textIndent: '0.28em', color: 'var(--dsw-alias-label-secondary)',
              fontFamily: layerFont.serif,
            },
          }, (record && record.a) || quote.a),
        ].filter(Boolean)),
        ...(Array.isArray(body) ? body : [body]),
      ]))
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
      /**
       * Whether the full-poem layer is showing.
       *
       * Not a new tab: the desktop shell denies `window.open` for every scheme but
       * http(s), and the app itself runs on `dsh-app:`, so a tab would do nothing
       * there. The layer is a page of its own inside this tree instead, which the
       * browser and the shell render identically.
       */
      const [poemOpen, setPoemOpen] = React.useState(false)
      // Live size of the verse block, used to clamp a dragged block to the viewport.
      // A ref (not state) so measuring does not re-render on every frame.
      const measuredRef = React.useRef(null)
      const blockRef = React.useRef(null)
      const [, forceMeasure] = React.useState(0)
      // Holds the latest stylesheet text. Kept in a ref so the effect below can write
      // it without a second render pass, and so the paint is refreshed even when the
      // entry re-renders for a reason unrelated to the quote (a resize, a hover).
      const stylesRef = React.useRef('')
      // The geometry this render resolved, published by the layout effect below and
      // recorded only when it actually changed.
      const geomRef = React.useRef(null)

      // Breadcrumbs. A missing verse is either an abdicated entry (error recorded,
      // no unmount) or an unmounted one (unmount recorded, no error); without these
      // two records the two cases are indistinguishable after the fact.
      React.useEffect(() => {
        trace('mount')
        return () => trace('unmount')
      }, [])

      const update = React.useCallback((patch) => {
        setSettings((current) => {
          const next = normalize({ ...current, ...patch })
          writeSettings(next)
          return next
        })
      }, [])

      // Follow viewport size, the app's light/dark switch, and layout shifts that
      // move the reading band (sidebar collapse, docked rightbar, window resize).
      //
      // The window `resize` event alone is not enough. The paper is painted by CSS,
      // which re-resolves against the real window on every frame, while the verse is
      // placed from the viewport size held in React state — so if the shell ever
      // resizes without delivering `resize` (a transparent / vibrancy window can),
      // the paint follows the window and the verse keeps its old coordinates, landing
      // outside the window. An element observer cannot go stale that way: it fires
      // from layout, not from an event the embedder has to forward.
      React.useEffect(() => {
        let frame = 0
        const remeasure = () => {
          const size = { w: window.innerWidth, h: window.innerHeight }
          setViewport((previous) => (
            previous.w === size.w && previous.h === size.h ? previous : size
          ))
          setBand((previous) => {
            const next = contentBand(size)
            return Math.abs(previous.left - next.left) < 0.5
              && Math.abs(previous.right - next.right) < 0.5
              ? previous
              : next
          })
        }
        // Coalesce bursts (a drag fires the observer on every frame), but never let
        // the coalescing be the reason a measurement is missed: an occluded or
        // backgrounded Electron window stops delivering animation frames, so a
        // frame-only schedule can starve. The timer runs either way and clears the
        // pending frame.
        let timer = 0
        const flush = () => {
          if (timer !== 0) { window.clearTimeout(timer); timer = 0 }
          if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
          remeasure()
        }
        const schedule = () => {
          if (timer !== 0) return
          timer = window.setTimeout(flush, 120)
          frame = window.requestAnimationFrame(() => {
            frame = 0
            flush()
          })
        }
        window.addEventListener('resize', schedule)
        window.visualViewport?.addEventListener('resize', schedule)
        // The document element is sized by the viewport, so this tracks the window
        // even when no resize event reaches the page.
        const viewportObserver = typeof ResizeObserver === 'function'
          ? new ResizeObserver(schedule)
          : null
        viewportObserver?.observe(document.documentElement)
        const observer = new MutationObserver(() => {
          setDarkApp(document.body.hasAttribute('data-ds-dark-theme'))
          schedule()
        })
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-ds-dark-theme', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'],
        })
        // The frame owns the column geometry; watch it too, then settle once.
        const frameNode = document.querySelector('[data-shell-overlay]')?.parentElement
        const frameObserver = frameNode ? new MutationObserver(schedule) : null
        if (frameNode && frameObserver) {
          frameObserver.observe(frameNode, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed'] })
        }
        const settle = window.setTimeout(remeasure, 250)
        return () => {
          window.removeEventListener('resize', schedule)
          window.visualViewport?.removeEventListener('resize', schedule)
          viewportObserver?.disconnect()
          observer.disconnect()
          frameObserver?.disconnect()
          window.clearTimeout(settle)
          if (timer !== 0) window.clearTimeout(timer)
          if (frame !== 0) window.cancelAnimationFrame(frame)
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

      // Publish the page stylesheet. Declared before the early return so the hook
      // order never depends on `settings.enabled`, and run as a layout effect so the
      // rules are in place before the browser paints the frame — the old `<style>`
      // child got that ordering for free from React's commit phase.
      React.useLayoutEffect(() => {
        writeStyles(stylesRef.current)
        const geometry = geomRef.current
        if (geometry !== null && geometry.signature !== lastGeomSignature) {
          lastGeomSignature = geometry.signature
          trace('geom', geometry.detail)
        }
      })

      if (!settings.enabled) {
        // Nothing to paint: drop the rules so the page falls back to the shell's own
        // fills instead of keeping the last rendered scene. The layout effect above
        // writes the empty string on this same pass.
        latestStyles = ''
        stylesRef.current = ''
        return null
      }

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

      // The numbers behind the verse box. A verse that is missing from a screenshot is
      // either an entry the shell replaced (the guard records an error) or a box that
      // was placed outside the window (no error, nothing on screen); only the measured
      // geometry separates the two, so it rides along in the same trace.
      const geometryDetail = {
        viewport: { w: viewport.w, h: viewport.h },
        band: { left: Math.round(band.left), right: Math.round(band.right) },
        anchor: {
          left: Math.round(anchorRect.left),
          top: Math.round(anchorRect.top),
          width: Math.round(anchorWidth),
        },
        orientation: orientation ? 'v' : 'h',
        sizePx,
        side: freeX ? 'free' : anchorSide,
        measured: known ? { w: Math.round(blockW), h: Math.round(blockH) } : null,
        insets: INSET,
      }
      geomRef.current = {
        signature: [
          viewport.w, viewport.h,
          Math.round(band.left), Math.round(band.right),
          Math.round(anchorRect.left), Math.round(anchorRect.top),
          orientation ? 'v' : 'h', sizePx, known ? Math.round(blockW) : -1,
          freeX ? 'free' : anchorSide,
        ].join('|'),
        detail: geometryDetail,
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
      latestStyles = styles
      stylesRef.current = styles

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

      /**
       * Show the poem's full text, the poet's life, and what is known about why
       * the poem was written.
       *
       * All of that belongs in prose — it would swamp a wallpaper — so it opens
       * as a layer above the verse (see `PoemLayer`). The record itself is read
       * from the Host half, which parses `data/details.json` once per process.
       */
      const showPoem = React.useCallback(() => setPoemOpen(true), [])
      const hidePoem = React.useCallback(() => setPoemOpen(false), [])

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
                // Opens the layer holding the poem's full text, the poet's life
                // and its background: prose that would swamp a wallpaper.
                h('button', {
                  key: 'd', type: 'button', title: '查看整首诗', 'aria-label': '查看整首诗',
                  'aria-expanded': poemOpen, onClick: showPoem,
                  style: { ...chipStyle, width: 26, padding: 0 },
                }, h(Glyph, { path: GLYPH.page })),
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

        poemOpen ? h(PoemLayer, {
          key: 'poem',
          quote,
          titleFamily: fontFamily(settings.font),
          onClose: hidePoem,
        }) : null,
      ].filter(Boolean))
    }

    /* ================================================================== *
     * Render guard
     * ================================================================== */

    // A slot entry that throws is replaced by the shell with an empty anchor, and the
    // shell never retries it: the verse and the seal vanish from a page that keeps
    // running (the stylesheet lives in <head>, so the paper survives) and only a
    // reload brings them back. This guard does the two things the shell does not —
    // it records what actually threw, and it retries the render instead of staying
    // dead.
    // The last stylesheet the component resolved. A crash anywhere below it in the
    // tree (a verse child, the seal, the panel) aborts the render before any layout
    // effect runs, so the head node would never receive the rules and the page would
    // fall back to the shell's own opaque fill — the paper would go as well as the
    // verse. The guard republishes this on the failure path so a broken child costs
    // only the child.
    let latestStyles = ''

    const ERROR_KEY = 'dsh-ipw-poem:last-error'
    const TRACE_KEY = 'dsh-ipw-poem:trace'
    const RETRY_LIMIT = 8
    const RETRY_DELAY = 600

    // A ring buffer of lifecycle events. A crash record on its own cannot tell an
    // abdicated entry from one the shell unmounted; this can, because an unmount
    // leaves a breadcrumb and no error.
    // The ring buffer lives in memory and reaches storage once per burst. Dragging a
    // verse changes its geometry on every frame, and a synchronous `setItem` per frame
    // is a write amplification the window drag can feel; the debounce collapses a
    // whole gesture into a single write without losing the last state of it.
    const TRACE_LIMIT = 60
    const TRACE_GEOM_LIMIT = 24
    const TRACE_FLUSH_DELAY = 400
    let traceBuffer = null
    let traceTimer = 0

    function readTrace() {
      if (traceBuffer !== null) return traceBuffer
      try {
        const raw = window.localStorage.getItem(TRACE_KEY)
        traceBuffer = raw ? JSON.parse(raw) : []
        if (!Array.isArray(traceBuffer)) traceBuffer = []
      } catch {
        traceBuffer = []
      }
      return traceBuffer
    }

    function trimTrace(list) {
      const geoms = []
      const rest = []
      for (const entry of list) (entry && entry.event === 'geom' ? geoms : rest).push(entry)
      const keptGeoms = geoms.slice(-TRACE_GEOM_LIMIT)
      const keptRest = rest.slice(-(TRACE_LIMIT - keptGeoms.length))
      // Rebuild in original order so the sequence still reads as a timeline.
      const keep = new Set([...keptGeoms, ...keptRest])
      return list.filter((entry) => keep.has(entry))
    }

    function flushTrace() {
      if (traceTimer !== 0) {
        window.clearTimeout(traceTimer)
        traceTimer = 0
      }
      if (traceBuffer === null) return
      try {
        window.localStorage.setItem(TRACE_KEY, JSON.stringify(trimTrace(traceBuffer)))
      } catch {
        // Tracing must never be the reason the wallpaper breaks.
      }
    }

    function trace(event, detail) {
      try {
        const list = readTrace()
        const entry = {
          at: new Date().toISOString(),
          event,
          w: window.innerWidth,
          h: window.innerHeight,
        }
        if (detail !== undefined) entry.detail = detail
        list.push(entry)
        while (list.length > TRACE_LIMIT * 2) list.shift()
        if (traceTimer === 0) {
          traceTimer = window.setTimeout(flushTrace, TRACE_FLUSH_DELAY)
        }
      } catch {
        // Tracing must never be the reason the wallpaper breaks.
      }
    }

    // The last geometry signature written to the trace. Layout values are re-derived
    // on every render; without this the ring buffer would hold nothing but repeats.
    let lastGeomSignature = ''

    function recordRenderError(error, info) {
      try {
        window.localStorage.setItem(ERROR_KEY, JSON.stringify({
          at: new Date().toISOString(),
          message: error && error.message ? String(error.message) : String(error),
          stack: error && error.stack ? String(error.stack) : '',
          componentStack: info && info.componentStack ? String(info.componentStack) : '',
          w: window.innerWidth,
          h: window.innerHeight,
        }))
        trace('render-error')
        flushTrace()
      } catch {
        // Same: never throw out of the reporter.
      }
      console.error('[ink-poem-wallpaper] render failed:', error)
    }

    class InkWashGuard extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, attempt: 0 }
        this.timer = null
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error, info) {
        recordRenderError(error, info)
        // Keep the painting: only the verse subtree failed, not the canvas.
        if (latestStyles !== '') writeStyles(latestStyles)
        this.retry()
      }

      componentWillUnmount() {
        if (this.timer !== null) window.clearTimeout(this.timer)
      }

      retry() {
        if (this.state.attempt >= RETRY_LIMIT) return
        if (this.timer !== null) window.clearTimeout(this.timer)
        this.timer = window.setTimeout(() => {
          this.timer = null
          this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))
        }, RETRY_DELAY)
      }

      render() {
        // While failed the painted canvas stays: the stylesheet is in <head>, so only
        // the verse subtree is missing, and only for the retry window.
        if (this.state.failed) return null
        return h(InkWash)
      }
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

        // The page canvas: the class hook, plus the one stylesheet node that carries
        // the actual paint. Both live and die with the plugin rather than with the
        // slot entry, so a re-render or an entry remount cannot drop the wallpaper
        // while the plugin is still loaded.
        ctx.effect(() => {
          document.body.classList.add('dsh-ipw-active')
          document.documentElement.classList.add('dsh-ipw-active')
          ensureStyleNode()
          return () => {
            document.body.classList.remove('dsh-ipw-active')
            document.documentElement.classList.remove('dsh-ipw-active')
            removeStyleNode()
          }
        }, 'ink-poem-wallpaper: page canvas')

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'ink-poem-wallpaper',
          order: -100,
        }, InkWashGuard))
      },
    }
  },
})
