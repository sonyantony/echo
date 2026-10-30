/**
 * Access to the side files of the flow being edited (DataMapper XSLT, JSON schemas, Kaoto metadata).
 * The Kaoto editor reads and writes them through this interface; the Builder stores them with the draft.
 */
export interface FlowFiles {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<boolean>;
  /** The names of the flow's files. */
  list(): Promise<string[]>;
}

/** Kaoto stores its metadata (e.g. DataMapper schema attachments) as JSON in this file. */
export const KAOTO_METADATA_FILE = '.kaoto';

/** The flow's Kaoto metadata (KAOTO_METADATA_FILE) by key; empty when it has none or it is not JSON. */
export async function readKaotoMetadata(files: FlowFiles): Promise<Record<string, unknown>> {
  const raw = await files.read(KAOTO_METADATA_FILE);
  if (!raw) return {};
  try {
    const metadata: unknown = JSON.parse(raw);
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const metadataWrites = new WeakMap<FlowFiles, Promise<unknown>>();

/**
 * Changes the flow's Kaoto metadata: change gets it as stored and edits it in place. One change at a
 * time per files (Kaoto's and ECHO's alike): each rewrites the whole file, so two at once would lose one.
 */
export function updateKaotoMetadata(files: FlowFiles, change: (metadata: Record<string, unknown>) => void): Promise<void> {
  const write = (metadataWrites.get(files) ?? Promise.resolve()).then(async () => {
    const metadata = await readKaotoMetadata(files);
    const before = JSON.stringify(metadata);
    change(metadata);
    if (JSON.stringify(metadata) !== before) await files.write(KAOTO_METADATA_FILE, JSON.stringify(metadata, null, 2));
  });
  metadataWrites.set(files, write.catch(() => undefined));
  return write;
}

/** The ids of the scaffold steps the user marked done (a JSON list), whose red circles stay away. */
export const DONE_STEPS_FILE = '.echo-done.json';

/** In-memory implementation, used by tests and the editor playground. */
export class InMemoryFlowFiles implements FlowFiles {
  readonly files = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([path, content]) => this.files.set(path, content));
  }

  async read(path: string) {
    return this.files.get(normalize(path));
  }

  async write(path: string, content: string) {
    this.files.set(normalize(path), content);
  }

  async remove(path: string) {
    return this.files.delete(normalize(path));
  }

  async list() {
    return [...this.files.keys()];
  }
}

/** Kaoto passes paths relative to the edited Camel file, sometimes with a leading "./". */
export function normalize(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '');
}
