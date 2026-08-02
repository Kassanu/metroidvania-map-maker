# Metroidvania Map Maker

A browser-based map maker for metroidvania games. Draw minimap-style maps on a
square-celled, unbounded grid: paint rooms, draw walls, place doors/transitions,
define areas, drop icons, and sketch path lines, then save, export images, and
export json data. Works with mouse/keyboard and touch/stylus, on desktop
and mobile.

Installable and offline-capable (PWA).

## Development

```bash
npm install       # install dependencies
npm run dev       # start the dev server
npm run build     # type-check + production build
npm run preview   # preview the production build

npm run test         # unit tests (watch)
npm run test:unit    # unit tests (once)
npm run test:e2e     # end-to-end tests (Playwright)
npm run type-check   # type-check only
```

> First e2e run: `npx playwright install` to fetch the browsers.
