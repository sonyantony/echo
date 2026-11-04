// Builds ECHO-Presentation-v2.html: one self-contained file that opens in any browser.
// Images are embedded; the IBM Plex fonts load from Google Fonts (other fonts are used offline).
// Keys: Right/Space/PageDown next, Left/PageUp previous, Home/End, F full screen, N speaker notes.
// Usage (from this folder): node build-html.js [out.html]
const fs = require('fs');
const path = require('path');

const deckDir = path.join(__dirname, 'deck');
const deck = JSON.parse(fs.readFileSync(path.join(deckDir, 'deck.json'), 'utf8'));
const images = JSON.parse(fs.readFileSync(path.join(deckDir, 'images.json'), 'utf8'));
const out = process.argv[2] || path.join(__dirname, 'ECHO-Presentation-v2.html');

let html = deck.order.map((id) => fs.readFileSync(path.join(deckDir, 'slides', id + '.html'), 'utf8')).join('\n');
for (const [blob, file] of Object.entries(images)) {
  const data = fs.readFileSync(path.join(deckDir, file)).toString('base64');
  html = html.split(blob).join('data:image/png;base64,' + data);
}
const fonts = Object.values(deck.faces).map((f) => `<link rel="stylesheet" href="${f.href}">`).join('\n');

fs.writeFileSync(out, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${deck.title}</title>
${fonts}
<style>
  html, body { margin: 0; height: 100%; background: #1b1b22; overflow: hidden; font-family: 'IBM Plex Sans', Arial, sans-serif }
  #stage { position: absolute; left: 50%; top: 50%; width: 1920px; height: 1080px; transform-origin: 0 0 }
  section { position: absolute; inset: 0; width: 1920px; height: 1080px; box-sizing: border-box; overflow: hidden; visibility: hidden }
  section.on { visibility: visible }
  section * { margin: 0; box-sizing: border-box }
  section aside { display: none }
  ul, ol { padding-left: 1.2em }
  table { border-collapse: collapse; width: 100% }
  th, td { text-align: left; vertical-align: top; padding: 18px 16px; border-bottom: 1px solid #4B4B57 }
  #bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 8px; align-items: center; justify-content: center; padding: 8px; font: 14px 'IBM Plex Sans', Arial, sans-serif; color: #C4C4CD; background: #1b1b22cc; opacity: 0; transition: opacity .2s }
  body:hover #bar { opacity: 1 }
  #bar button { font: inherit; color: #F2F2EE; background: #3A3A46; border: 1px solid #747480; border-radius: 4px; padding: 4px 12px; cursor: pointer }
  #bar button:focus-visible { outline: 2px solid #FFE600 }
  #notes { position: fixed; left: 0; right: 0; bottom: 44px; max-height: 30vh; overflow: auto; margin: 0 auto; max-width: 900px; padding: 16px 20px; background: #2E2E38ee; color: #F2F2EE; font: 16px/1.5 'IBM Plex Sans', Arial, sans-serif; border-top: 3px solid #FFE600; display: none }
  body.notes #notes { display: block }
</style>
</head>
<body>
<div id="stage">
${html}
</div>
<div id="notes"></div>
<div id="bar">
  <button id="prev" aria-label="Previous slide">&#8592;</button>
  <span id="count"></span>
  <button id="next" aria-label="Next slide">&#8594;</button>
  <button id="notesBtn">Notes (N)</button>
  <button id="fsBtn">Full screen (F)</button>
</div>
<script>
  const slides = Array.from(document.querySelectorAll('#stage > section'));
  const stage = document.getElementById('stage');
  let i = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'scale(' + s + ') translate(-50%, -50%)';
  }
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((el, k) => el.classList.toggle('on', k === i));
    document.getElementById('count').textContent = (i + 1) + ' / ' + slides.length;
    const aside = slides[i].querySelector('aside');
    document.getElementById('notes').textContent = aside ? aside.textContent : 'No notes for this slide.';
    history.replaceState(null, '', '#' + (i + 1));
  }
  const toggleNotes = () => document.body.classList.toggle('notes');
  const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
  addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(i + 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if (e.key === 'n' || e.key === 'N') toggleNotes();
    else if (e.key === 'f' || e.key === 'F') toggleFs();
  });
  stage.addEventListener('click', (e) => show(e.clientX > innerWidth / 2 ? i + 1 : i - 1));
  document.getElementById('prev').onclick = () => show(i - 1);
  document.getElementById('next').onclick = () => show(i + 1);
  document.getElementById('notesBtn').onclick = toggleNotes;
  document.getElementById('fsBtn').onclick = toggleFs;
  addEventListener('resize', fit);
  fit(); show(i);
</script>
</body>
</html>
`);
console.log('Wrote ' + out);
