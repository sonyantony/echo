# 0001. M1 spike: embedding Kaoto and mapping JSON with the DataMapper

Date: 2026-10-14
Status: Accepted (GO, no fallback needed)

## Question

Can the EY ECHO Builder embed Kaoto in its own React app, and can Kaoto's DataMapper map an
incoming HTTP JSON request to a different downstream JSON request (and the response back),
in a flow that runs with Camel JBang and as an exported Spring Boot app?

## Result

**GO on both parts.** Neither fallback (iframe, JSONata) is needed.

### Kaoto embedding

- `@kaoto/kaoto` 2.13.0 exports `KaotoEditorFactory`, the same entry point the VS Code
  extension uses. The Builder calls it with a small in-page "envelope context"
  (`builder-ui/src/editor/kaotoEnvelope.ts`) instead of the VS Code host, so we get the full
  editor: canvas, step forms, Beans, Rest and the DataMapper.
- Kaoto brings its own hash router and providers, so `KaotoEditorHost` renders it into a
  separate React root. Kaoto stays unmodified.
- Side files are handled through the envelope: the DataMapper's XSLT, attached JSON schemas
  and Kaoto's metadata file (`.kaoto`) are read and written through a `FlowFiles` interface,
  which the Builder will back with the draft store (M4/M5). Schema upload uses a browser
  file picker.
- Kaoto 2.13 requires **React 19 and PatternFly 6**, so the Builder UI uses those instead of
  React 18 / PatternFly 5 from the plan. Its SCSS uses webpack-style `~` imports, handled by a
  small Sass importer in `vite.config.ts`.
- Kaoto needs the Camel catalog as static files. `@kaoto/camel-catalog` is 440 MB, so
  `builder-ui/scripts/copy-camel-catalog.mjs` copies only the pinned
  **Camel Spring Boot 4.22.1** catalog (about 31 MB) into `public/camel-catalog`.

Checked by `builder-ui/e2e/editor-spike.spec.ts` (Playwright): Kaoto renders the orders flow,
returns the YAML, and in the DataMapper a JSON schema is attached on each side, a field is
dragged from source to target, and the generated XSLT contains the mapping.

### JSON DataMapper at runtime

- The DataMapper step is a Camel `step` wrapping `xslt-saxon:<id>.xsl` with
  `useJsonBody: true` (supported from Camel 4.22's `xslt-saxon`). The XSLT reads the JSON as
  XPath 3.1 `fn:map` XML and writes JSON with `xml-to-json()`.
- The golden flow `samples/flows/orders` (POST `/orders` → map → HTTP call to the fulfilment
  service → map response) ran with:
  - `camel run` (Camel 4.22.1), and
  - `camel export --runtime=spring-boot` (Spring Boot 4.1.1) → `mvn package` → `java -jar`.

  Both returned the mapped response:

  ```
  $ curl -XPOST localhost:8086/orders -H 'Content-Type: application/json' -d @sample-request.json
  {"orderId":"A100","fulfilmentId":"FUL-A100","status":"ACCEPTED"}
  ```

  and the mock downstream received
  `{"reference":"A100","customerName":"Jane Doe","lines":[{"product":"SKU-1","quantity":2},{"product":"SKU-2","quantity":1}]}`.

## Consequences

- **Pinned versions:** Camel 4.22.1 (Kaoto catalog, Camel JBang, runtime), Kaoto 2.13.0,
  React 19, PatternFly 6. The Builder backend stays on Spring Boot 3.5 (it does not run flows);
  exported flows use the Spring Boot version Camel 4.22.1 chooses (4.1.1).
- **Flow folder layout:** `camel export` copies resources flat into the app, and Kaoto names
  DataMapper files `kaoto-datamapper-<id>.xsl` next to the route. So flow side files (XSLT,
  schemas, `.kaoto`) sit in the flow folder itself, not in `mappings/` and `schemas/`
  sub-folders as the plan sketched.
- **Camel JBang in CI:** the plain `camel-launcher` jar works with `java -jar`. `camel run` and
  `camel export` try to reach `registry.quarkus.io` unless `--quarkus-version` is given;
  pipeline scripts pass it to keep builds offline-friendly.
- **To check later (M5):** array-to-array (for-each) mapping by drag and drop was not
  automated in the spike; the golden XSLT includes a for-each that runs correctly.
