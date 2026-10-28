/** A body or response that was just set to a data type made from a sample, and has no example yet. */
export interface NewlyTyped {
  /** Where it is in the spec, e.g. components/responses/GetNode/application/json. */
  at: string;
  mediaType: string;
  /** The data type's name. */
  type: string;
  /** The data type's example: the sample it was made from (specFromSamples.ts). */
  sample: unknown;
}

const SCHEMA_REF = '#/components/schemas/';
const VERBS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * The bodies and responses whose type changed between two versions of the spec (editor JSON) to a
 * data type with an example (New From Samples keeps the sample there) and which have no example of
 * their own. Only a change counts, so an example the user deleted is not put back.
 */
export function newlyTyped(before: string | undefined, now: string): NewlyTyped[] {
  const old = refs(before);
  const result: NewlyTyped[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(now);
  } catch {
    return [];
  }
  const schemas = asObject(asObject(asObject(doc).components).schemas);
  for (const [at, media, mediaType] of mediaTypes(doc)) {
    const ref = asObject(media.schema).$ref;
    if (typeof ref !== 'string' || !ref.startsWith(SCHEMA_REF) || old.get(at) === ref) continue;
    if (media.example !== undefined || media.examples !== undefined) continue;
    const type = ref.slice(SCHEMA_REF.length);
    const sample = asObject(schemas[type]).example;
    if (sample === undefined) continue;
    result.push({ at, mediaType, type, sample });
  }
  return result;
}

/**
 * Gives the body or response on screen its type's sample as example, the way a user would: its
 * row's Add an example, the name "sample" and the sample as value, then Add (an ordinary edit, so
 * undo takes it back). Apicurio cannot be handed changes without opening it again. Each call takes
 * the next step; call it again until it says it is done.
 *
 * @returns 'done' when the example was added, 'wait' while it is on its way, 'none' when the row is
 *          not on screen (or not only once)
 */
export function fillSampleExample(doc: Document, target: NewlyTyped): 'done' | 'wait' | 'none' {
  const rows = [...doc.querySelectorAll<HTMLElement>('media-type-row')].filter((row) => {
    const name = row.querySelector('.media-type .name [title]')?.getAttribute('title');
    const type = row.querySelector('.media-type .type')?.textContent?.trim();
    return name === target.mediaType && type === target.type;
  });
  if (rows.length !== 1) return 'none';
  const row = rows[0];
  const modal = row.querySelector<HTMLElement>('add-example-dialog #addExampleModal');
  if (modal && modal.style.display !== 'none') {
    const name = modal.querySelector<HTMLInputElement>('input[name="exampleName"]');
    const add = [...modal.querySelectorAll<HTMLButtonElement>('.modal-footer button')].find((b) => b.textContent?.trim() === 'Add');
    // The code editor is Ace, which keeps its editor on the element (env.editor).
    const ace = (modal.querySelector('.ace_editor') as (HTMLElement & { env?: { editor?: { setValue(v: string, cursor?: number): void } } }) | null)
      ?.env?.editor;
    if (!name || !add || !ace) return 'wait';
    if (name.value !== 'sample') {
      name.value = 'sample';
      name.dispatchEvent(new (doc.defaultView?.Event ?? Event)('input', { bubbles: true }));
      ace.setValue(JSON.stringify(target.sample, null, 2), -1);
      return 'wait';
    }
    if (add.disabled) return 'wait';
    add.click();
    return 'done';
  }
  if (!row.querySelector('.media-type .examples')?.textContent?.includes('No examples defined')) return 'none';
  const link = [...row.querySelectorAll<HTMLElement>('a')].find((a) => a.textContent?.trim() === 'Add an example');
  if (link) link.click();
  else row.querySelector<HTMLElement>('.media-type .examples')?.click();
  return 'wait';
}

/** Every media type of a body or response: where it is, the media type object, and its name. */
function mediaTypes(doc: unknown): [string, Record<string, unknown>, string][] {
  const found: [string, Record<string, unknown>, string][] = [];
  const add = (at: string, holder: unknown) => {
    for (const [type, media] of Object.entries(asObject(asObject(holder).content))) {
      if (media && typeof media === 'object' && !Array.isArray(media)) found.push([`${at}/${type}`, media as Record<string, unknown>, type]);
    }
  };
  for (const [path, item] of Object.entries(asObject(asObject(doc).paths))) {
    for (const [verb, op] of Object.entries(asObject(item))) {
      if (!VERBS.has(verb)) continue;
      add(`paths/${path}/${verb}/requestBody`, asObject(op).requestBody);
      for (const [code, response] of Object.entries(asObject(asObject(op).responses))) add(`paths/${path}/${verb}/${code}`, response);
    }
  }
  const components = asObject(asObject(doc).components);
  for (const [name, response] of Object.entries(asObject(components.responses))) add(`components/responses/${name}`, response);
  for (const [name, body] of Object.entries(asObject(components.requestBodies))) add(`components/requestBodies/${name}`, body);
  return found;
}

/** The $ref of every media type, by where it is. */
function refs(json: string | undefined): Map<string, unknown> {
  try {
    return new Map(mediaTypes(json === undefined ? {} : JSON.parse(json)).map(([at, media]) => [at, asObject(media.schema).$ref]));
  } catch {
    return new Map();
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
