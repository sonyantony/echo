// Renders an SVG diagram to a PNG at 2x with the IBM Plex fonts loaded.
// Usage: node render.js <in.svg> <out.png>   (needs Playwright with Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [inFile, outFile] = process.argv.slice(2);
  const svg = fs.readFileSync(inFile, 'utf8');
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +m[1], height: +m[2] }, deviceScaleFactor: 2 });
  await page.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"><style>body{margin:0}</style></head><body>${svg}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: outFile });
  await browser.close();
})();
