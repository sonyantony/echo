import { useMemo, useRef, useState } from 'react';
import { InMemoryFlowFiles } from '../editor/flowFiles';
import { KaotoEditorHost, type KaotoEditorHandle } from '../editor/KaotoEditorHost';
import ordersYaml from '../../../samples/flows/orders/orders.camel.yaml?raw';

/** Editor playground used by the M1 spike: loads a YAML flow and reads the edited YAML back. */
export function Playground() {
  const files = useMemo(() => new InMemoryFlowFiles(), []);
  const editor = useRef<KaotoEditorHandle>(null);
  const [yaml, setYaml] = useState('');
  const [changes, setChanges] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: 8, display: 'flex', gap: 8 }}>
        <button data-testid="read-yaml" onClick={async () => setYaml((await editor.current?.getContent()) ?? '')}>
          Read YAML
        </button>
        <span data-testid="change-count">{changes}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <KaotoEditorHost
          ref={editor}
          path="orders.camel.yaml"
          initialContent={ordersYaml}
          files={files}
          onChange={() => setChanges((c) => c + 1)}
        />
      </div>
      <pre data-testid="yaml-out" style={{ maxHeight: 200, overflow: 'auto', margin: 0 }}>{yaml}</pre>
      <pre data-testid="files-out" hidden>{JSON.stringify(Object.fromEntries(files.files))}</pre>
    </div>
  );
}
