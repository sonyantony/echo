import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlowFiles } from '../editor/flowFiles';
import { checkSpecMappings, refreshSpecSchemas, type MappingWarning } from './specMappings';
import { isGeneratedSchemaName } from './specSchemas';

/** Waits this long after the DataMapper's last write before checking its mappings again. */
const CHECK_DELAY_MS = 1500;

interface Options {
  files: FlowFiles;
  /** The flow's saved Openapi spec; undefined when it has none. */
  readSpec(): Promise<Record<string, unknown> | undefined>;
  /** The Camel YAML on screen, to name each step's route. */
  readRoute(): Promise<string | undefined>;
}

/**
 * Keeps the DataMapper schemas made from the flow's Openapi spec up to date and lists the mappings
 * that use fields the spec no longer has. review(true) after the spec is saved makes the schema
 * files again first; mapping changes (the DataMapper writing its .xsl or .kaoto) check again by themselves.
 * Returns files to give the editor in place of files, so those writes are seen.
 */
export function useSpecMappingReview({ files, readSpec, readRoute }: Options) {
  const [warnings, setAllWarnings] = useState<MappingWarning[]>([]);
  const [error, setError] = useState<string>();
  // Left alone when nothing changed, so a check does not redraw the editor.
  const setWarnings = useCallback(
    (next: MappingWarning[]) => setAllWarnings((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next)),
    [],
  );
  const queue = useRef<Promise<void>>(Promise.resolve());
  const options = useRef({ readSpec, readRoute });
  options.current = { readSpec, readRoute };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const review = useCallback(
    (refresh: boolean) => {
      const run = async () => {
        try {
          const names = await files.list();
          if (!names.some(isGeneratedSchemaName)) {
            setWarnings([]);
            return;
          }
          const spec = refresh ? await options.current.readSpec() : undefined;
          const gone = spec ? await refreshSpecSchemas(files, names, spec) : undefined;
          setWarnings(await checkSpecMappings(files, gone, await options.current.readRoute()));
          setError(undefined);
        } catch (e) {
          setError(`Could not check the DataMapper steps against the Openapi spec: ${(e as Error).message}`);
        }
      };
      queue.current = queue.current.then(run);
      return queue.current;
    },
    [files, setWarnings],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const watchedFiles = useMemo<FlowFiles>(() => {
    const later = (path: string) => {
      if (!/\.xsl$|^\.?\/?\.kaoto$|\.schema\.json$/.test(path)) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void review(false), CHECK_DELAY_MS);
    };
    return {
      read: (path) => files.read(path),
      list: () => files.list(),
      write: async (path, content) => {
        await files.write(path, content);
        later(path);
      },
      remove: async (path) => {
        const removed = await files.remove(path);
        later(path);
        return removed;
      },
    };
  }, [files, review]);

  return { warnings, error, review, files: watchedFiles };
}
