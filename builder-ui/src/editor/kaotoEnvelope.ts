import type { KaotoEditorChannelApi } from '@kaoto/kaoto';
import { KAOTO_METADATA_FILE, normalize, type FlowFiles } from './flowFiles';

export interface EnvelopeCallbacks {
  onReady(): void;
  onNewEdit(content: string): void;
  /** Lets the user pick local files (e.g. JSON schemas); returns file name to content. */
  pickFiles(include: string, canPickMany: boolean): Promise<Record<string, string> | undefined>;
}

/**
 * Builds the minimal "envelope context" Kaoto's editor expects from its host
 * (in VS Code this is the extension). Here the host is the ECHO Builder page itself.
 */
export function createEnvelopeContext(catalogUrl: string, files: FlowFiles, callbacks: EnvelopeCallbacks) {
  const readMetadata = async (): Promise<Record<string, unknown>> => {
    const raw = await files.read(KAOTO_METADATA_FILE);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };

  const requests: Partial<Record<keyof KaotoEditorChannelApi, unknown>> = {
    getVSCodeKaotoSettings: async () => ({
      catalogUrl,
      runtimeCatalogName: 'Camel Spring Boot 4.22.1',
      colorScheme: 'light',
      // Kaoto's default ('onHover') also shows a step toolbar on every hovered step, so a
      // selected step and a hovered one showed two toolbars at once. Only the selected step's shows.
      nodeToolbarTrigger: 'onSelection',
    }),
    getCatalogURL: async () => catalogUrl,
    getMetadata: async (key: string) => (await readMetadata())[key],
    setMetadata: async (key: string, value: unknown) => {
      const metadata = await readMetadata();
      if (value === undefined) delete metadata[key];
      else metadata[key] = value;
      await files.write(KAOTO_METADATA_FILE, JSON.stringify(metadata, null, 2));
    },
    getResourcesContentByType: async () => [],
    getResourceContent: (path: string) => files.read(normalize(path)),
    isResourceExist: async (path: string) => (await files.read(normalize(path))) !== undefined,
    saveResourceContent: (path: string, content: string) => files.write(normalize(path), content),
    deleteResource: (path: string) => files.remove(normalize(path)),
    askUserForFileSelection: async (include: string, _exclude?: string, options?: Record<string, unknown>) => {
      const picked = await callbacks.pickFiles(include, !!options?.canPickMany);
      if (!picked) return undefined;
      await Promise.all(Object.entries(picked).map(([name, content]) => files.write(name, content)));
      return Object.keys(picked);
    },
    getSuggestions: async () => [],
    getRuntimeInfoFromMavenContext: async () => undefined,
    onStepUpdated: async () => undefined,
  };

  const notify = (handler: (...args: never[]) => void) => ({ send: handler, subscribe: () => undefined });

  return {
    channelApi: {
      requests,
      notifications: {
        kogitoEditor_ready: notify(() => callbacks.onReady()),
        kogitoWorkspace_newEdit: notify(((edit: { id: string }) => callbacks.onNewEdit(edit.id)) as never),
        kogitoNotifications_setNotifications: notify(() => undefined),
        kogitoEditor_stateControlCommandUpdate: notify(() => undefined),
      },
      shared: {},
    },
    services: {
      keyboardShortcuts: { registerKeyPress: () => 0, registerKeyDownThenUp: () => 0, deregister: () => undefined, isEnabled: false },
      i18n: { getLocale: async () => 'en', subscribeToLocaleChange: () => undefined },
    },
    operatingSystem: undefined,
    supportedThemes: [],
  };
}
