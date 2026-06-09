/**
 * Runs once when the server instance starts, before any request is handled
 * (Next.js guarantees `register` completes first — see instrumentation.js docs).
 *
 * pdf-parse (via its bundled pdfjs-dist) needs browser globals DOMMatrix /
 * ImageData / Path2D that don't exist in Node, and its own internal polyfill
 * (a `require` of @napi-rs/canvas resolved relative to its own bundled file
 * path) is unreliable once Turbopack repackages it as an external module —
 * causing "ReferenceError: DOMMatrix is not defined".
 *
 * Worse, per the ES module spec, a module that throws during evaluation is
 * permanently cached in an "errored" state: every later `import('pdf-parse')`
 * instantly rethrows the same cached error without re-evaluating. So the
 * polyfill must be installed AND pdf-parse must be successfully imported once
 * — here, where both are guaranteed to happen before any route can ever touch
 * pdf-parse — so the module registry caches a working module, not a broken one.
 *
 * Separately, in production pdfjs-dist (which pdf-parse bundles) tries to set
 * up a "fake worker" by dynamically importing its own pdf.worker.mjs from a
 * path it computes at runtime — a pattern Vercel's deployment file-tracer
 * can't follow statically, so the file is missing from the deployed bundle:
 * `Cannot find module '.../pdfjs-dist/legacy/build/pdf.worker.mjs'`. Before
 * trying that dynamic import, pdfjs-dist first checks for a ready-made
 * `globalThis.pdfjsWorker.WorkerMessageHandler` — so we import the worker
 * ourselves (a literal path the tracer *can* follow, ensuring it's bundled)
 * and stash it there, and pdfjs-dist never attempts the runtime import at all.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const napiCanvas = await import('@napi-rs/canvas')
  for (const [name, value] of [
    ['DOMMatrix', napiCanvas.DOMMatrix],
    ['ImageData', napiCanvas.ImageData],
    ['Path2D', napiCanvas.Path2D],
  ] as const) {
    if (!(name in globalThis)) {
      Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
    }
  }

  // @ts-expect-error — pdfjs-dist ships no types for its worker entry point
  const pdfWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  if (!('pdfjsWorker' in globalThis)) {
    Object.defineProperty(globalThis, 'pdfjsWorker', {
      value: { WorkerMessageHandler: pdfWorker.WorkerMessageHandler },
      writable: true,
      configurable: true,
    })
  }

  await import('pdf-parse')
}
