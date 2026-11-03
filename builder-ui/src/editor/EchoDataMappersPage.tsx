import { Button, Content, EmptyState, EmptyStateBody, Spinner, Title } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDataMappers, type DataMapperEntry } from './dataMapperList';
import { EntitiesContext, SettingsContext } from './kaotoInternals';

/**
 * ECHO's Datamappers tab: the flow's Kaoto DataMappers, each named as the canvas names it (its
 * description). Clicking one opens it, as its Configure button on the canvas does.
 *
 * vite.config.ts points Kaoto's lazy DataMapper "how to" route at this module, so Kaoto stays unmodified.
 */
export function Component() {
  const entities = useContext(EntitiesContext);
  const settings = useContext(SettingsContext);
  const navigate = useNavigate();
  const [dataMappers, setDataMappers] = useState<DataMapperEntry[]>();
  const visualEntities = entities?.visualEntities;

  useEffect(() => {
    let cancelled = false;
    listDataMappers(visualEntities ?? [], settings?.getSettings().nodeLabel)
      .then((found) => !cancelled && setDataMappers(found))
      .catch(() => !cancelled && setDataMappers([]));
    return () => {
      cancelled = true;
    };
  }, [visualEntities, settings]);

  const open = (id: string) => void navigate(`/datamapper/${encodeURIComponent(id)}`);

  return (
    <section className="echo-datamappers" data-testid="echo-datamappers">
      <Title headingLevel="h1" size="xl">
        Datamappers
      </Title>
      {!dataMappers ? (
        <Spinner size="lg" aria-label="Finding the flow's DataMappers" />
      ) : dataMappers.length === 0 ? (
        <EmptyState titleText="This flow has no DataMappers" headingLevel="h2" variant="sm">
          <EmptyStateBody>
            Add a Kaoto DataMapper step to a route on the Flow &gt; Design canvas. It is listed here by its description.
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <>
          <Content component="p">
            The DataMappers in this flow, named by their descriptions as on the canvas. Click one to open it.
          </Content>
          <Table aria-label="DataMappers in this flow" variant="compact" className="echo-datamappers__table">
            <Thead>
              <Tr>
                <Th width={45}>Datamapper</Th>
                <Th width={30}>Route</Th>
                <Th width={25}>Step ID</Th>
              </Tr>
            </Thead>
            <Tbody>
              {dataMappers.map((d) => (
                <Tr key={`${d.routeId}/${d.id}`} isClickable onRowClick={() => open(d.id)} data-testid="echo-datamapper-row">
                  <Td dataLabel="Datamapper">
                    <Button variant="link" isInline onClick={(e) => (e.stopPropagation(), open(d.id))}>
                      {d.label}
                    </Button>
                  </Td>
                  <Td dataLabel="Route">{d.routeLabel}</Td>
                  <Td dataLabel="Step ID" modifier="nowrap" className="echo-datamappers__id">
                    {d.id}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </>
      )}
    </section>
  );
}
