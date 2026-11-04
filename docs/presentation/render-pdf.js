// Renders the deck's slide files to a PDF, one 1920x1080 page per slide, in deck.json order.
// Usage (from this folder): node render-pdf.js [out.pdf]   (needs Playwright with Chromium)
// The deck's own Export in the live deck is the reference; this is a close offline copy.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const deckDir = path.join(__dirname, 'deck');
const deck = JSON.parse(fs.readFileSync(path.join(deckDir, 'deck.json'), 'utf8'));
const images = JSON.parse(fs.readFileSync(path.join(deckDir, 'images.json'), 'utf8'));
const out = process.argv[2] || path.join(__dirname, 'ECHO-Presentation-v2.pdf');

let sections = deck.order.map((id) => fs.readFileSync(path.join(deckDir, 'slides', id + '.html'), 'utf8'));
let html = sections.join('\n');
for (const [blob, file] of Object.entries(images)) {
  const data = fs.readFileSync(path.join(deckDir, file)).toString('base64');
  html = html.split(blob).join('data:image/png;base64,' + data);
}
const fonts = Object.values(deck.faces).map((f) => `<link rel="stylesheet" href="${f.href}">`).join('');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(`<html><head>${fonts}<style>
    @page { size: 1920px 1080px; margin: 0 }
    body { margin: 0 }
    section { position: relative; width: 1920px; height: 1080px; box-sizing: border-box; overflow: hidden; break-after: page }
    section * { margin: 0; box-sizing: border-box }
    aside { display: none }
    ul, ol { padding-left: 1.2em }
    table { border-collapse: collapse; width: 100% }
    th, td { text-align: left; vertical-align: top; padding: 18px 16px; border-bottom: 1px solid #4B4B57 }
  </style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true });
  if (process.env.SHOTS) {
    const n = deck.order.length;
    for (let i = 0; i < n; i++) {
      await page.evaluate((i) => document.querySelectorAll('section')[i].scrollIntoView(), i);
      await page.locator('section').nth(i).screenshot({ path: path.join(process.env.SHOTS, `slide-${i + 1}.png`) });
    }
  }
  await browser.close();
})();
