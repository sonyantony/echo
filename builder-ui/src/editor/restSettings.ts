import { isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq } from 'yaml';

/**
 * The REST settings the Flow menu turns on and off. They live in the route file's
 * `restConfiguration`, where Camel reads them; ECHO adds the rest service itself from the flow's
 * OpenAPI spec when the flow runs or is published (RestFromSpec in the backend).
 */
export const REST_SETTINGS = ['clientRequestValidation', 'enableCORS'] as const;
export type RestSetting = (typeof REST_SETTINGS)[number];
export type RestSettings = Record<RestSetting, boolean>;

function restConfiguration(seq: YAMLSeq): { entry: YAMLMap; conf: unknown } | undefined {
  for (const item of seq.items) {
    if (isMap(item) && item.has('restConfiguration')) return { entry: item, conf: item.get('restConfiguration') };
  }
  return undefined;
}

const isOn = (value: unknown) => {
  const v = isScalar(value) ? value.value : value;
  return v === true || v === 'true';
};

/** Which settings the route YAML turns on (all off when it cannot be read). */
export function readRestSettings(yaml: string): RestSettings {
  const settings: RestSettings = { clientRequestValidation: false, enableCORS: false };
  try {
    const doc = parseDocument(yaml);
    const found = isSeq(doc.contents) ? restConfiguration(doc.contents) : undefined;
    if (found && isMap(found.conf)) {
      for (const key of REST_SETTINGS) settings[key] = isOn(found.conf.get(key, true));
    }
  } catch {
    // Kaoto only hands over YAML it can read.
  }
  return settings;
}

/**
 * The route YAML with one setting turned on or off. On adds a `restConfiguration` when the flow has
 * none; off removes the setting, and the `restConfiguration` too once it is empty.
 */
export function writeRestSetting(yaml: string, key: RestSetting, on: boolean): string {
  const doc = parseDocument(yaml.trim() ? yaml : '[]');
  if (!isSeq(doc.contents)) throw new Error('The flow is not a list of routes, so its REST settings cannot be changed.');
  const seq: YAMLSeq = doc.contents;
  const found = restConfiguration(seq);
  if (on) {
    if (!found) {
      seq.items.unshift(doc.createNode({ restConfiguration: { [key]: true } }));
    } else if (isMap(found.conf)) {
      found.conf.set(key, true);
    } else {
      found.entry.set('restConfiguration', doc.createNode({ [key]: true }));
    }
  } else if (found && isMap(found.conf)) {
    found.conf.delete(key);
    if (found.conf.items.length === 0) seq.items.splice(seq.items.indexOf(found.entry), 1);
  }
  // A list that was written as [] (an empty flow) is written as a block list once it has items.
  seq.flow = false;
  return seq.items.length ? doc.toString({ indentSeq: true }) : '';
}
