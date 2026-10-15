import { InMemoryFlowFiles, KAOTO_METADATA_FILE } from './flowFiles';
import { createEnvelopeContext } from './kaotoEnvelope';

function setup(initial: Record<string, string> = {}) {
  const files = new InMemoryFlowFiles(initial);
  const callbacks = {
    onReady: vi.fn(),
    onNewEdit: vi.fn(),
    pickFiles: vi.fn(async () => ({ 'order.schema.json': '{"type":"object"}' })),
  };
  const envelope = createEnvelopeContext('http://localhost/camel-catalog/index.json', files, callbacks);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests = envelope.channelApi.requests as any;
  return { files, callbacks, envelope, requests };
}

describe('Kaoto envelope context', () => {
  it('stores Kaoto metadata in the .kaoto file of the flow', async () => {
    const { files, requests } = setup();
    await requests.setMetadata('kaoto-datamapper-1', { xsltPath: 'kaoto-datamapper-1.xsl' });

    expect(JSON.parse(files.files.get(KAOTO_METADATA_FILE)!)).toEqual({
      'kaoto-datamapper-1': { xsltPath: 'kaoto-datamapper-1.xsl' },
    });
    expect(await requests.getMetadata('kaoto-datamapper-1')).toEqual({ xsltPath: 'kaoto-datamapper-1.xsl' });
  });

  it('removes a metadata key when set to undefined', async () => {
    const { files, requests } = setup({ [KAOTO_METADATA_FILE]: '{"a":1,"b":2}' });
    await requests.setMetadata('a', undefined);
    expect(JSON.parse(files.files.get(KAOTO_METADATA_FILE)!)).toEqual({ b: 2 });
  });

  it('reads and writes side files relative to the flow', async () => {
    const { files, requests } = setup();
    await requests.saveResourceContent('./mapping.xsl', '<xsl/>');
    expect(files.files.get('mapping.xsl')).toBe('<xsl/>');
    expect(await requests.getResourceContent('mapping.xsl')).toBe('<xsl/>');
    expect(await requests.isResourceExist('missing.xsl')).toBe(false);
    expect(await requests.deleteResource('mapping.xsl')).toBe(true);
  });

  it('saves files the user picks and returns their names', async () => {
    const { files, requests, callbacks } = setup();
    const names = await requests.askUserForFileSelection('**/*.json', undefined, { canPickMany: true });
    expect(callbacks.pickFiles).toHaveBeenCalledWith('**/*.json', true);
    expect(names).toEqual(['order.schema.json']);
    expect(files.files.get('order.schema.json')).toBe('{"type":"object"}');
  });

  it('forwards editor edits and readiness to the host', () => {
    const { envelope, callbacks } = setup();
    const notifications = envelope.channelApi.notifications as unknown as Record<string, { send(...a: unknown[]): void }>;
    notifications.kogitoEditor_ready.send();
    notifications.kogitoWorkspace_newEdit.send({ id: '- route: {}' });
    expect(callbacks.onReady).toHaveBeenCalled();
    expect(callbacks.onNewEdit).toHaveBeenCalledWith('- route: {}');
  });

  it('points Kaoto at the bundled Camel Spring Boot catalog', async () => {
    const { requests } = setup();
    const settings = await requests.getVSCodeKaotoSettings();
    expect(settings.catalogUrl).toBe('http://localhost/camel-catalog/index.json');
    expect(settings.runtimeCatalogName).toBe('Camel Spring Boot 4.22.1');
  });
});
