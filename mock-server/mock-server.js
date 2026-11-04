#!/usr/bin/env node
/**
 * OpenAPI Mock Server with call logging
 *
 * Usage:   node mock-server.js <openapi.yaml|json> [port]
 * Needs:   npm install yaml   (or js-yaml; JSON specs need nothing)
 *
 * - Every request is printed to the console: operation, path params, query params, headers of note, body.
 * - Responds with the operation's 200 (or first 2xx) response, using `example`/`examples`
 *   from the spec when present, otherwise a dummy payload generated from the schema.
 * - Live call log in the browser:  http://localhost:<port>/__ui
 * - Call history as JSON:          GET  /__calls      (DELETE /__calls clears it)
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const specFile = process.argv[2];
const PORT = Number(process.argv[3] || process.env.PORT || 4010);
if (!specFile) {
  console.error('Usage: node mock-server.js <openapi.yaml> [port]');
  process.exit(1);
}

const raw = fs.readFileSync(specFile, 'utf8');
function parseYaml(text) {
  try { return require('yaml').parse(text); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  try { return require('js-yaml').load(text); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  console.error('YAML spec needs a parser: run  npm install yaml  (or js-yaml)'); process.exit(1);
}
const spec = specFile.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);

// ---------- $ref resolution (local refs only) ----------
function resolveRef(ref) {
  if (!ref.startsWith('#/')) return {};
  return ref.slice(2).split('/').reduce(
    (o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec) || {};
}
function deref(obj, seen = new Set()) {
  if (obj && obj.$ref) {
    if (seen.has(obj.$ref)) return {};          // break cycles
    const next = new Set(seen); next.add(obj.$ref);
    return deref(resolveRef(obj.$ref), next);
  }
  return obj;
}

// ---------- dummy data generation ----------
function sample(schema, depth = 0, seen = new Set()) {
  if (!schema) return null;
  if (schema.$ref) {
    if (seen.has(schema.$ref) || depth > 8) return null;
    const next = new Set(seen); next.add(schema.$ref);
    return sample(resolveRef(schema.$ref), depth + 1, next);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.examples && Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum && schema.enum.length) return schema.enum[0];
  if (schema.allOf) {
    return schema.allOf.reduce((acc, s) => {
      const v = sample(s, depth + 1, seen);
      return v && typeof v === 'object' && !Array.isArray(v) ? { ...acc, ...v } : acc;
    }, {});
  }
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf || schema.anyOf)[0], depth + 1, seen);

  let type = schema.type;
  if (Array.isArray(type)) type = type.find(t => t !== 'null') || 'null';
  if (!type) type = schema.properties ? 'object' : schema.items ? 'array' : 'string';

  switch (type) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties || {})) out[k] = sample(v, depth + 1, seen);
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !schema.properties)
        out.key = sample(schema.additionalProperties, depth + 1, seen);
      return out;
    }
    case 'array':
      return depth > 8 ? [] : [sample(schema.items || {}, depth + 1, seen)];
    case 'integer':
      return schema.minimum ?? 1;
    case 'number':
      return schema.minimum ?? 1.5;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default: // string
      switch (schema.format) {
        case 'date-time': return new Date().toISOString();
        case 'date': return new Date().toISOString().slice(0, 10);
        case 'uuid': return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
        case 'email': return 'user@example.com';
        case 'uri': case 'url': return 'https://example.com';
        case 'byte': return 'ZHVtbXk=';
        default: return 'string';
      }
  }
}

// ---------- route table ----------
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
let basePath = '';
try {
  const s = spec.servers && spec.servers[0] && spec.servers[0].url;
  if (s) basePath = new URL(s, 'http://x').pathname.replace(/\/$/, '');
} catch { /* ignore */ }

const routes = [];
for (const [p, itemRaw] of Object.entries(spec.paths || {})) {
  const item = deref(itemRaw);
  const names = [];
  const regex = new RegExp('^' + p.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]+)\}/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
  for (const m of METHODS) {
    if (!item[m]) continue;
    routes.push({ method: m.toUpperCase(), path: p, regex, names, op: item[m],
      literalChars: p.replace(/\{[^}]+\}/g, '').length });
  }
}
// prefer the most literal match (/users/me before /users/{id})
routes.sort((a, b) => b.literalChars - a.literalChars);

function match(method, pathname) {
  const candidates = [pathname];
  if (basePath && pathname.startsWith(basePath)) candidates.push(pathname.slice(basePath.length) || '/');
  for (const pth of candidates) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pth);
      if (m) {
        const params = {};
        r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
    }
  }
  return null;
}

// responses/<operationId>.json next to this script overrides the spec; read on every call so it can be
// edited while the server runs. "{{param}}" in it is replaced by that path or query param.
const RESPONSES_DIR = path.join(__dirname, 'responses');
function overrideBody(op, vars) {
  if (!op.operationId) return undefined;
  const file = path.join(RESPONSES_DIR, op.operationId + '.json');
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf8').replace(/\{\{([^}]+)\}\}/g, (all, n) => (n in vars ? vars[n] : all));
  try { return JSON.parse(text); } catch (e) { console.error(`${file}: ${e.message}`); return undefined; }
}

// Specs that only say "type: object" give {}; fill it from the path params so the caller gets something.
function fillEmpty(body, params, pathname) {
  const isEmpty = o => o && typeof o === 'object' && !Array.isArray(o) && !Object.keys(o).length;
  const filler = () => {
    const o = { ...params };
    if (params.resourceType) o['@type'] = params.resourceType;
    o.href = pathname;
    return o;
  };
  if (isEmpty(body)) return filler();
  if (Array.isArray(body) && body.length && body.every(isEmpty)) return [filler()];
  return body;
}

// getResources always answers with this real Blue Planet Device (from a Lumen call); every
// "AVDLAZRH4P001" in it, also inside longer values, becomes the call's ?name= (kept when name is missing).
const GET_RESOURCES_TOKEN = 'AVDLAZRH4P001';
const GET_RESOURCES_BODY = [
  {
    "id": "a1168a08-ec8a-4ac6-83ae-79b5c2609084",
    "name": "AVDLAZRH4P001",
    "href": "https://a403ea31db64240f8a23055590046d28-d0b4c8262dd985c2.elb.us-east-1.amazonaws.com/blueplanet-inventory-tmf-api/resourceInventoryManagement/Device/a1168a08-ec8a-4ac6-83ae-79b5c2609084",
    "@baseType": "PhysicalResource",
    "@type": "Device",
    "startDate": "2026-01-29T21:48:55.000Z",
    "resourceSpecification": {
      "id": "10263005193",
      "name": "ADVA FSP 150-GE114Pro 1G NID (4P)",
      "@type": "Device",
      "isBundle": false
    },
    "place": {
      "id": "3b1ac549-898d-43fa-a8fb-40c3642ec132",
      "name": "AVDLAZRH",
      "role": "Location",
      "href": "https://a403ea31db64240f8a23055590046d28-d0b4c8262dd985c2.elb.us-east-1.amazonaws.com/blueplanet-inventory-tmf-api/resourceInventoryManagement/Location/3b1ac549-898d-43fa-a8fb-40c3642ec132"
    },
    "relatedParty": [
      {
        "id": "256264613132841968",
        "name": "objectId",
        "href": "./device/fetchExisting/256264613132841968/108",
        "@type": "108",
        "@referredType": "inventory"
      }
    ],
    "resourceCharacteristic": [
      {
        "name": "adoptionUUID",
        "value": "DEVICE-3164712-AVDLAZRH",
        "@type": "string"
      },
      {
        "name": "createdBy",
        "value": "AFFSUPERTST",
        "@type": "string"
      },
      {
        "name": "createdDate",
        "value": "1769723335000",
        "@type": "string"
      },
      {
        "name": "dedicatedDevice",
        "value": "No",
        "@type": "string"
      },
      {
        "name": "defaultShelftype",
        "value": "0",
        "@type": "string"
      },
      {
        "name": "deviceName",
        "value": "AVDLAZRH4P001",
        "@type": "string"
      },
      {
        "name": "equipmentCode",
        "value": "4P",
        "@type": "string"
      },
      {
        "name": "inventoryName",
        "value": "AVDLAZRHADVAA4PNID001",
        "@type": "string"
      },
      {
        "name": "isGNE",
        "value": "No",
        "@type": "string"
      },
      {
        "name": "isHybridPE",
        "value": "No",
        "@type": "string"
      },
      {
        "name": "isNID",
        "value": "Yes",
        "@type": "string"
      },
      {
        "name": "lastModifiedDate",
        "value": "1775246915000",
        "@type": "string"
      },
      {
        "name": "legacyCompany",
        "value": "TW TELECOM",
        "@type": "string"
      },
      {
        "name": "legacyInventorySystem",
        "value": "ASRI",
        "@type": "string"
      },
      {
        "name": "legacyObjectId",
        "value": "3164712",
        "@type": "string"
      },
      {
        "name": "legacyRoleCode",
        "value": "NID",
        "@type": "string"
      },
      {
        "name": "legacyTypeCode",
        "value": "A4P",
        "@type": "string"
      },
      {
        "name": "locationName",
        "value": "AVDLAZRH",
        "@type": "string"
      },
      {
        "name": "migrationCycle",
        "value": "Cycle-18",
        "@type": "string"
      },
      {
        "name": "migrationSource",
        "value": "bulk_load",
        "@type": "string"
      },
      {
        "name": "modelNumber",
        "value": "N/A",
        "@type": "string"
      },
      {
        "name": "modifiedBy",
        "value": "AFFSUPERTST",
        "@type": "string"
      },
      {
        "name": "name",
        "value": "AVDLAZRH4P001",
        "@type": "string"
      },
      {
        "name": "networkName",
        "value": "AVDLAZRH4P001",
        "@type": "string"
      },
      {
        "name": "objClass",
        "value": "LIVE",
        "@type": "string"
      },
      {
        "name": "onNet",
        "value": "No",
        "@type": "string"
      },
      {
        "name": "operationalState",
        "value": "Not Specified",
        "@type": "string"
      },
      {
        "name": "portNumber",
        "value": "1",
        "@type": "string"
      },
      {
        "name": "pseudo_Enabled",
        "value": "Yes",
        "@type": "string"
      },
      {
        "name": "role",
        "value": "[]",
        "@type": "string"
      },
      {
        "name": "roleCode",
        "value": "NID - Network Interface Device",
        "@type": "string"
      },
      {
        "name": "status",
        "value": "In Service",
        "@type": "string"
      },
      {
        "name": "typeCode",
        "value": "A4P - Adva FSP 150-GE114Pro",
        "@type": "string"
      },
      {
        "name": "x25",
        "value": "No",
        "@type": "string"
      }
    ],
    "resourceRelationship": [
      {
        "type": "Shelf",
        "resource": {
          "id": "63993923-c1c4-42b6-9c66-3e1c32837760",
          "href": "https://a403ea31db64240f8a23055590046d28-d0b4c8262dd985c2.elb.us-east-1.amazonaws.com/blueplanet-inventory-tmf-api/resourceInventoryManagement/Shelf/63993923-c1c4-42b6-9c66-3e1c32837760"
        },
        "resourceRelationshipCharacteristic": [
          {
            "name": "name",
            "value": "AVDLAZRH4P001_001-10-105-10549",
            "@type": "string"
          },
          {
            "name": "relatedObjectType",
            "value": "Shelf",
            "@type": "string"
          },
          {
            "name": "objectId",
            "value": "256264613133515356",
            "@type": "string"
          },
          {
            "name": "relationshipType",
            "value": "HAS",
            "@type": "string"
          },
          {
            "name": "specType",
            "value": "FSP 150CC-GE114Pro/AC (4P)",
            "@type": "string"
          }
        ]
      },
      {
        "type": "ShelfPosition:HAS:OUT",
        "resource": {
          "id": "ae8e4b19-afd3-4dc7-b929-cbf042b41626",
          "href": "https://a403ea31db64240f8a23055590046d28-d0b4c8262dd985c2.elb.us-east-1.amazonaws.com/blueplanet-inventory-tmf-api/resourceInventoryManagement/ShelfPosition/ae8e4b19-afd3-4dc7-b929-cbf042b41626"
        },
        "resourceRelationshipCharacteristic": [
          {
            "name": "name",
            "value": "ADVA FSP 150-GE114Pro 1G NID (4P) - Shelf Position-01",
            "@type": "string"
          },
          {
            "name": "relatedObjectType",
            "value": "ShelfPosition",
            "@type": "string"
          },
          {
            "name": "objectId",
            "value": "256264613132301650",
            "@type": "string"
          },
          {
            "name": "relationshipType",
            "value": "HAS",
            "@type": "string"
          },
          {
            "name": "specType",
            "value": "ADVA FSP 150-GE114Pro 1G NID (4P) - Shelf Position",
            "@type": "string"
          }
        ]
      }
    ]
  }
];
function getResourcesBody(query) {
  let name = query.name;
  if (Array.isArray(name)) name = name[0];
  if (name === undefined || name === '') name = GET_RESOURCES_TOKEN;
  const swap = v => typeof v === 'string' ? v.split(GET_RESOURCES_TOKEN).join(name)
    : Array.isArray(v) ? v.map(swap)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
    : v;
  return swap(GET_RESOURCES_BODY);
}

function buildResponse(op, params = {}, query = {}, pathname = '') {
  const responses = op.responses || {};
  const code = ['200', ...Object.keys(responses).filter(c => /^2\d\d$/.test(c)).sort()]
    .find(c => responses[c]) || '200';
  const resp = deref(responses[code] || responses['2XX'] || responses.default || {});
  const status = code === '204' ? 204 : 200;
  if (op.operationId === 'getResources') return { status: 200, ctype: 'application/json', body: getResourcesBody(query) };
  const override = overrideBody(op, { ...query, ...params });
  if (override !== undefined) return { status: status === 204 ? 200 : status, ctype: 'application/json', body: override };
  const content = resp.content || {};
  let ctype = Object.keys(content).find(c => c.includes('json')) || Object.keys(content)[0];
  if (!ctype || status === 204) return { status, ctype: null, body: null };
  const media = content[ctype];
  let body;
  if (media.example !== undefined) body = media.example;
  else if (media.examples) {
    const first = deref(Object.values(media.examples)[0]);
    body = first ? first.value : undefined;
  }
  if (body === undefined) body = fillEmpty(sample(media.schema || {}), params, pathname);
  // "*/*" (common in springdoc specs) is not a real content type; send JSON
  if (body !== null && typeof body === 'object' && !ctype.includes('json')) ctype = 'application/json';
  return { status, ctype, body };
}

// ---------- logging ----------
const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m',
  green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', red: '\x1b[31m', blue: '\x1b[34m' };
const METHOD_COLOR = { GET: C.green, POST: C.yellow, PUT: C.blue, PATCH: C.cyan, DELETE: C.red };
const calls = [];
let callNo = 0;

function pretty(obj) {
  return JSON.stringify(obj, null, 2).split('\n').map(l => '      ' + l).join('\n');
}

function logCall(c) {
  const mc = METHOD_COLOR[c.method] || C.magenta;
  console.log(`\n${C.dim}──────────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.dim}#${c.id}  ${c.time}${C.reset}`);
  console.log(`${mc}${C.bold}${c.method}${C.reset} ${C.bold}${c.path}${C.reset}` +
    (c.operationId ? `  →  ${C.magenta}${c.operationId}${C.reset}` : '') +
    (c.matched ? '' : `  ${C.red}(no matching operation in spec)${C.reset}`));
  if (c.summary) console.log(`   ${C.dim}${c.summary}${C.reset}`);
  if (Object.keys(c.pathParams).length) console.log(`   ${C.cyan}Path params:${C.reset}\n${pretty(c.pathParams)}`);
  if (Object.keys(c.query).length) console.log(`   ${C.cyan}Query params:${C.reset}\n${pretty(c.query)}`);
  if (Object.keys(c.headers).length) console.log(`   ${C.cyan}Headers:${C.reset}\n${pretty(c.headers)}`);
  if (c.body !== undefined) console.log(`   ${C.cyan}Body:${C.reset}\n${typeof c.body === 'string' ? '      ' + c.body : pretty(c.body)}`);
  console.log(`   ${C.green}← ${c.status}${C.reset}`);
  if (c.response !== undefined) console.log(`   ${C.cyan}Response:${C.reset}\n${pretty(c.response)}`);
}

// ---------- live UI ----------
const UI = `<!doctype html><html><head><meta charset="utf-8"><title>Mock calls</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1d2330}
header{position:sticky;top:0;background:#1d2330;color:#fff;padding:12px 16px;display:flex;gap:12px;align-items:center}
header h1{font-size:16px;margin:0;flex:1}button{cursor:pointer;border:0;border-radius:6px;padding:6px 10px}
#list{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.call{background:#fff;border-radius:8px;padding:10px 12px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.m{font-weight:700;font-family:monospace;padding:2px 6px;border-radius:4px;color:#fff}
.GET{background:#2e9e5b}.POST{background:#d08b10}.PUT{background:#2f6fd6}.PATCH{background:#139ca8}.DELETE{background:#d13c3c}
.p{font-family:monospace;font-weight:600}.op{color:#7a3fc2;font-family:monospace}.t{margin-left:auto;color:#888;font-size:12px}
.nomatch{color:#d13c3c;font-size:12px}h4{margin:8px 0 2px;font-size:12px;color:#556}
pre{margin:0;background:#f2f3f6;padding:6px 8px;border-radius:6px;overflow:auto;font-size:12px}
.cp{margin-left:8px;padding:1px 8px;font-size:11px;background:#dde1ea;color:#1d2330;user-select:none}.cp.ok{background:#2e9e5b;color:#fff}
</style></head><body><header><h1>Mock server calls <span id="n"></span></h1>
<button onclick="fetch('/__calls',{method:'DELETE'}).then(()=>load(true))">Clear</button></header><div id="list"></div>
<script>
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const sec=(t,o)=>o===undefined||(typeof o==='object'&&o&&!Object.keys(o).length)?'':'<h4>'+t+'<button class="cp" type="button">Copy</button></h4><pre>'+esc(typeof o==='string'?o:JSON.stringify(o,null,2))+'</pre>';
// Re-render only when the call list changed, and never while the user is selecting text.
let last='',down=false;
addEventListener('mousedown',()=>{down=true});addEventListener('mouseup',()=>{down=false});addEventListener('blur',()=>{down=false});
const busy=()=>down||String(getSelection()).length>0;
function fallbackCopy(s){const ta=document.createElement('textarea');ta.value=s;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}finally{ta.remove()}}
function copyText(s){if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(s).catch(()=>fallbackCopy(s));fallbackCopy(s);return Promise.resolve()}
document.getElementById('list').addEventListener('click',e=>{const b=e.target.closest('.cp');if(!b)return;const pre=b.parentElement.nextElementSibling;
copyText(pre.textContent).then(()=>{b.textContent='Copied';b.classList.add('ok');setTimeout(()=>{b.textContent='Copy';b.classList.remove('ok')},1200)})});
async function load(force){if(!force&&busy())return;const r=await fetch('/__calls');const txt=await r.text();if(!force&&(txt===last||busy()))return;last=txt;const cs=JSON.parse(txt);document.getElementById('n').textContent='('+cs.length+')';
document.getElementById('list').innerHTML=cs.slice().reverse().map(c=>'<div class="call"><div class="top"><span class="m '+c.method+'">'+c.method+'</span><span class="p">'+esc(c.path)+'</span>'+(c.operationId?'<span class="op">'+esc(c.operationId)+'</span>':'')+(c.matched?'':'<span class="nomatch">no matching operation</span>')+'<span class="t">#'+c.id+' · '+c.time+' · '+c.status+'</span></div>'+sec('Path params',c.pathParams)+sec('Query params',c.query)+sec('Body',c.body)+sec('Response',c.response)+'</div>').join('');}
load(true);setInterval(()=>load(false),1500);
</script></body></html>`;

// headers worth showing (skip noise)
const SHOW_HEADERS = /^(authorization|x-|content-type|accept$|api-key|apikey)/i;

// ---------- server ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');

  if (url.pathname === '/__ui') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(UI); }
  if (url.pathname === '/__calls') {
    if (req.method === 'DELETE') { calls.length = 0; res.writeHead(204); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(calls));
  }
  if (req.method === 'OPTIONS' && !match('OPTIONS', url.pathname)) { res.writeHead(204); return res.end(); }

  const chunks = [];
  req.on('data', d => chunks.push(d));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body;
    if (rawBody) {
      const ct = req.headers['content-type'] || '';
      if (ct.includes('json')) { try { body = JSON.parse(rawBody); } catch { body = rawBody; } }
      else if (ct.includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(rawBody));
      else body = rawBody;
    }
    const query = {};
    for (const [k, v] of url.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (SHOW_HEADERS.test(k)) headers[k] = v;

    const m = match(req.method, url.pathname);
    let out = { status: 404, ctype: 'application/json', body: { error: 'No matching operation in spec' } };
    if (m) out = buildResponse(m.route.op, m.params, query, url.pathname);

    const call = {
      id: ++callNo, time: new Date().toISOString(), method: req.method, path: url.pathname,
      matched: !!m, operationId: m && m.route.op.operationId, summary: m && m.route.op.summary,
      specPath: m && m.route.path, pathParams: m ? m.params : {}, query, headers, body, status: out.status,
      response: out.body ?? undefined,
    };
    calls.push(call);
    if (calls.length > 500) calls.shift();
    logCall(call);

    if (out.ctype) {
      res.writeHead(out.status, { 'Content-Type': out.ctype });
      res.end(out.ctype.includes('json') ? JSON.stringify(out.body, null, 2) : String(out.body ?? ''));
    } else { res.writeHead(out.status); res.end(); }
  });
});

server.listen(PORT, () => {
  console.log(`${C.bold}Mock server for ${spec.info?.title || path.basename(specFile)}${C.reset} on http://localhost:${PORT}` +
    (basePath ? `  (base path ${basePath} optional)` : ''));
  console.log(`Live call log: http://localhost:${PORT}/__ui\n`);
  for (const r of routes) console.log(`  ${(METHOD_COLOR[r.method] || '') + r.method.padEnd(7) + C.reset} ${r.path}` +
    (r.op.operationId ? `  ${C.dim}${r.op.operationId}${C.reset}` : ''));
});
