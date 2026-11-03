import { Button } from '@patternfly/react-core';
import { ArrowLeftIcon } from '@patternfly/react-icons';
import { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findDataMapperNode, listDataMappers, type DataMapperEntry } from './dataMapperList';
import { DataMapper, EntitiesContext, SettingsContext } from './kaotoInternals';

type DataMapperNode = NonNullable<Parameters<typeof DataMapper>[0]['vizNode']>;

/**
 * One DataMapper, opened from the canvas's Configure button or the Datamappers list: Kaoto's own
 * DataMapper under a line naming it, whose arrow goes back to the list.
 *
 * Kaoto's page looks the step up among the canvas's nodes, so a step in a route hidden on the canvas
 * (Routes drop-down) was not found; this one builds it from the flow. vite.config.ts puts it in place
 * of Kaoto's page.
 */
export function Component() {
  const { id = '' } = useParams();
  const entities = useContext(EntitiesContext);
  const settings = useContext(SettingsContext);
  const navigate = useNavigate();
  const visualEntities = entities?.visualEntities;
  const [found, setFound] = useState<{ id: string; node?: DataMapperNode; entry?: DataMapperEntry }>();

  useEffect(() => {
    let cancelled = false;
    const all = visualEntities ?? [];
    Promise.all([findDataMapperNode<DataMapperNode>(all, id), listDataMappers(all, settings?.getSettings().nodeLabel)])
      .then(([node, entries]) => !cancelled && setFound({ id, node, entry: entries.find((e) => e.id === id) }))
      .catch(() => !cancelled && setFound({ id }));
    return () => {
      cancelled = true;
    };
  }, [visualEntities, settings, id]);

  const current = found?.id === id ? found : undefined;

  return (
    <div className="echo-datamapper-page" data-testid="echo-datamapper-page">
      <div className="echo-datamapper-page__header">
        <Button
          variant="plain"
          icon={<ArrowLeftIcon />}
          aria-label="All Datamappers"
          title="All Datamappers"
          onClick={() => void navigate('/datamapper')}
        />
        <strong data-testid="echo-datamapper-name">{current?.entry?.label ?? id}</strong>
        {current?.entry && <span className="echo-datamapper-page__route">in {current.entry.routeLabel}</span>}
      </div>
      <div className="echo-datamapper-page__body">
        {current && (current.node ? <DataMapper vizNode={current.node} /> : <p>This flow has no DataMapper {id}.</p>)}
      </div>
    </div>
  );
}
