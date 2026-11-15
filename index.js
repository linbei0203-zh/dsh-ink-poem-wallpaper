/**
 * Host half of the ink-poem wallpaper bundle.
 *
 * The Client half draws everything; the Host has one job here: serve the brush
 * faces the verse is set in, plus the two seal plates. They are subset to exactly
 * the characters the quote pool uses, so a face is a few hundred kilobytes instead
 * of several megabytes, and glyph coverage is guaranteed by construction — a font
 * that is missing a character is what produces the garbled strokes this avoids.
 *
 * Faces are SIL Open Font License 1.1 (see fonts/OFL.txt); each is served from the
 * bundle so the wallpaper needs no network access.
 */
import { readFile, realpath } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-ink-poem-wallpaper'
export const inject = ['webServer']

const ROUTE = '/ink-poem-wallpaper'
const ASSET_ROOT = resolve(fileURLToPath(new URL('./fonts/', import.meta.url)))

// Only these types are ever served. A name that resolves to something else — a
// stray file dropped in fonts/, or a symlink — is refused rather than streamed.
const MIME = Object.freeze({
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
})

/**
 * The asset root with symlinks resolved, computed once.
 *
 * A plain `resolve()` only normalises `..`; it says nothing about symlinks, so a
 * link placed inside `fonts/` would pass a string prefix check and be read from
 * wherever it pointed. Comparing the *real* paths closes that.
 */
const REAL_ROOT = realpath(ASSET_ROOT).catch(() => ASSET_ROOT)

function finish(res, status, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end()
}

/**
 * Serve one asset from `fonts/`.
 *
 * Every path that is not a plain, known-type file directly inside the asset root
 * answers 404 — including anything that throws while being read. Letting a read
 * error escape would leave the response unwritten and the request hanging.
 */
async function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    finish(res, 405, { allow: 'GET, HEAD' })
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? ROUTE, 'http://dsh.local').pathname)
  } catch {
    finish(res, 400)
    return
  }

  const suffix = pathname.startsWith(`${ROUTE}/`) ? pathname.slice(ROUTE.length + 1) : ''
  // One flat file name, no separators, no NUL. This also rejects every encoded
  // traversal form before it reaches the filesystem.
  if (!suffix || /[/\\\0]/.test(suffix) || suffix.startsWith('.')) {
    finish(res, 404)
    return
  }

  const type = MIME[extname(suffix).toLowerCase()]
  if (type === undefined) {
    finish(res, 404)
    return
  }

  try {
    const root = await REAL_ROOT
    const target = resolve(root, suffix)
    if (target === root || !target.startsWith(`${root}${sep}`)) {
      finish(res, 404)
      return
    }
    // Resolve the target too: a symlink inside the root must not lead out of it.
    const real = await realpath(target)
    if (!real.startsWith(`${root}${sep}`)) {
      finish(res, 404)
      return
    }

    const body = await readFile(real)
    res.writeHead(200, {
      // The subset only changes when the bundle is rebuilt, so this is safe to cache
      // for a day; the URL carries no revision, hence the modest max-age.
      'cache-control': 'public, max-age=86400',
      'content-length': String(body.byteLength),
      'content-type': type,
      'x-content-type-options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    // Missing, unreadable, or an invalid path: all indistinguishable from the
    // caller's point of view, and none of them may escape as a rejected promise.
    finish(res, 404)
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: serveAsset,
  }), 'ink-poem-wallpaper: asset route')
}
