# ECHO presentation

The source of the "ECHO Presentation v2" deck and its diagrams. The live, editable deck is
<https://claude.ai/artifact/UBMEkLgqua1j4QJQxxXeRB>; these files are its copy in Git.

| Path | What | Edit it? |
|---|---|---|
| `deck/deck.json` | Deck index: title, slide order, sections, fonts | Master |
| `deck/slides/<id>.html` | One slide each (1920×1080, inline styles), speaker notes in `<aside>` | Master |
| `deck/images/` | Images the slides show | Made from `diagrams/` |
| `deck/images.json` | Maps each `/_blob/<id>` in the slides to its file in `deck/images/` | |
| `diagrams/*.svg` | Diagrams as vector files (open in a browser, Inkscape, Illustrator, Figma, Visio) | Master |
| `diagrams/ingress-routing.py` | Writes `ingress-routing.svg`; paths, pod counts and switch position are at the top | Master |
| `diagrams/*.png` | 2× renders of the SVGs, for PowerPoint or email | Made by `render.js` |
| `ECHO-Presentation-v2.pdf` | All slides, one page each | Made by `render-pdf.js` |
| `ECHO-Presentation-v2.html` | The whole deck in one file: open it in a browser to present | Made by `build-html.js` |

Slide order: Platform, Using ECHO, Typical Steps, Demo, Built-in Features,
DevOps Pipeline (diagram), Request Routing Using Ingress (diagram), the four parts, Internals.

## Making the outputs again

Needs Node with Playwright and Chromium, and network access to Google Fonts (IBM Plex).

```bash
cd docs/presentation/diagrams
python3 ingress-routing.py                                  # after changing the Ingress diagram
node render.js ingress-routing.svg ingress-routing.png
node render.js build-deploy-flow-slide.svg build-deploy-flow-slide.png
cp ingress-routing.png ../deck/images/ingress-routing.png
cp build-deploy-flow-slide.png ../deck/images/build-deploy-flow.png

cd ..
node render-pdf.js                                          # writes ECHO-Presentation-v2.pdf
node build-html.js                                          # writes ECHO-Presentation-v2.html
```

`build-deploy-flow.svg` is the pipeline diagram with its own heading, for use outside the deck;
`build-deploy-flow-slide.svg` is the same without the heading, as used on the slide.

In the HTML deck, use the arrow keys or click to move between slides, N for speaker notes and F for full screen;
`#4` at the end of the address opens slide 4. Images are inside the file; the IBM Plex fonts load from Google Fonts, so
without internet it falls back to Arial.

The PDF and HTML here are made offline from the slide files and can differ slightly from the live deck.
For PowerPoint, use Export in the live deck (PowerPoint layouts may shift, so the slide files stay the master).

## Changing the live deck from these files

The slides point at images by their upload id (`/_blob/<id>`). To publish a changed image, upload it
to the deck, put the new id in the slide file and in `images.json`, then publish the changed slide files.
