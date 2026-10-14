/**
 * Access to the side files of the flow being edited (DataMapper XSLT, JSON schemas, Kaoto metadata).
 * The Kaoto editor reads and writes them through this interface; the Builder stores them with the draft.
 */
export interface FlowFiles {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<boolean>;
}

/** Kaoto stores its metadata (e.g. DataMapper schema attachments) as JSON in this file. */
export const KAOTO_METADATA_FILE = '.kaoto';

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
}

/** Kaoto passes paths relative to the edited Camel file, sometimes with a leading "./". */
export function normalize(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '');
}
