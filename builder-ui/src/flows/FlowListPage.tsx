import { EmptyState, EmptyStateBody, PageSection, Title } from '@patternfly/react-core';

/** Flow list. CRUD arrives in M4. */
export function FlowListPage() {
  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Flows</Title>
      </PageSection>
      <PageSection isFilled>
        <EmptyState titleText="No flows yet" headingLevel="h2">
          <EmptyStateBody>Flows you create will be listed here.</EmptyStateBody>
        </EmptyState>
      </PageSection>
    </>
  );
}
