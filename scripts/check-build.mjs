// Loads the production build in both engines and reports anything wrong with
// it.
//
//     npm run check:build
//
// Everything else in this repo tests the dev server, where the service worker
// does not exist and the manifest is never generated. So the two things that
// only ship in a build have no coverage at all from the suites: a worker that
// breaks the app, and a manifest naming an icon that did not survive the copy.
// Both fail silently and only in production, which is the worst place to find
// out.
//
// Deliberately a script rather than a Playwright project. It needs a build
// first, so folding it into `playwright test` would put a fifteen-second
// build in front of every canvas test.

import { chromium, firefox } from 'playwright'
import { preview } from 'vite'

const PORT = 4173

const server = await preview({ preview: { port: PORT, strictPort: true } })
const base = server.resolvedUrls.local[0]

let failed = false

function report(engine, label, detail) {
  console.log(`  ${label}: ${detail}`)
}

for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await engine.launch()
  const page = await browser.newPage()

  // Anything the page complains about, including requests that 404. A missing
  // icon or a broken precache entry shows up here and nowhere else.
  const problems = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error}`))
  page.on('requestfailed', (request) =>
    problems.push(`request failed: ${request.url()} ${request.failure()?.errorText}`),
  )
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`)
  })

  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Get started' }).click()

  const worker = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false }
    const registration = await navigator.serviceWorker.getRegistration()
    return { supported: true, registered: !!registration, active: !!registration?.active }
  })

  // Every icon the manifest names, fetched from where the manifest says it is.
  // The unit test checks they exist in `public/`; this checks they survived
  // the build and resolve against the deployed base.
  //
  // Judged on the content type rather than the status. A single-page host
  // answers anything it cannot find with `index.html` and a 200, so a status
  // check here passes for a file that is not there: measured, with the
  // manifest pointed at a deliberately absent icon.
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href')
    if (!href) return { error: 'no manifest link in the document' }
    const response = await fetch(href)
    if (!response.ok) return { error: `manifest returned ${response.status}` }
    const json = await response.json()
    const icons = [...(json.icons ?? []), ...(json.file_handlers?.[0]?.icons ?? [])]
    const broken = []
    for (const icon of icons) {
      const url = new URL(icon.src, new URL(href, location.href))
      const found = await fetch(url)
      const type = found.headers.get('content-type') ?? ''
      if (!found.ok || !type.startsWith('image/')) broken.push(`${icon.src} (${type || 'gone'})`)
    }
    return { icons: icons.length, broken, handlers: json.file_handlers?.length ?? 0 }
  })

  const running = await page.getByRole('button', { name: 'File', exact: true }).isVisible()

  console.log(`\n${name}`)
  report(name, 'app', running ? 'loaded' : 'DID NOT LOAD')
  report(
    name,
    'service worker',
    worker.supported ? (worker.active ? 'active' : 'NOT ACTIVE') : 'unsupported',
  )
  report(
    name,
    'manifest',
    manifest.error ??
      `${manifest.icons} icons, ${manifest.handlers} file handler(s)` +
        (manifest.broken.length ? `, BROKEN: ${manifest.broken.join(', ')}` : ''),
  )
  report(name, 'problems', problems.length ? `\n    ${problems.join('\n    ')}` : 'none')

  if (
    !running ||
    !worker.active ||
    manifest.error ||
    manifest.broken?.length ||
    problems.length > 0
  ) {
    failed = true
  }

  await browser.close()
}

await server.close()
console.log(failed ? '\nFAILED' : '\nok')
process.exit(failed ? 1 : 0)
