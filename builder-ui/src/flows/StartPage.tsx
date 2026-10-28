import { Button, EmptyState, EmptyStateActions, EmptyStateBody, EmptyStateFooter, PageSection } from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { flowsApi } from '../api/flows';
import { FlowFormModal } from './FlowFormModal';
import { FLOWS_KEY, OPEN_FLOW_PATH, type OpenFlowState } from './FlowListPage';
import { OpenTemplateModal } from './OpenTemplateModal';
import { UploadFlowModal } from './UploadFlowModal';
import './StartPage.css';

/**
 * Where you land after logging in. Work always happens on a flow that has a name of its own, so
 * there is no canvas here: you start a new flow (which asks for its name first), or open one.
 */
export function StartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const openFlowState: OpenFlowState = { from: '/' };

  const openDraft = async (id: number) => {
    await queryClient.invalidateQueries({ queryKey: FLOWS_KEY });
    navigate(`/flows/${id}`);
  };

  return (
    <PageSection className="echo-start" isFilled>
      <div className="echo-start__card">
        <EmptyState titleText="Start with a flow" headingLevel="h1">
          <EmptyStateBody>
            Every flow has a name of its own. Start a new flow, or open one that exists, to work on it.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="primary" onClick={() => setCreating(true)}>
                New Flow
              </Button>
              <Button variant="secondary" onClick={() => navigate(OPEN_FLOW_PATH, { state: openFlowState })}>
                Open Flow
              </Button>
            </EmptyStateActions>
            <EmptyStateActions>
              <Button variant="link" onClick={() => setOpeningTemplate(true)}>
                Open Flow Template
              </Button>
              <Button variant="link" onClick={() => setUploading(true)}>
                Upload Flow
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      </div>

      {creating && (
        <FlowFormModal
          title="New flow"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name, description) => openDraft((await flowsApi.create(name, description)).id)}
        />
      )}
      {openingTemplate && (
        <OpenTemplateModal onClose={() => setOpeningTemplate(false)} onOpened={(created) => openDraft(created.id)} />
      )}
      {uploading && (
        <UploadFlowModal onClose={() => setUploading(false)} onUploaded={(created) => openDraft(created.id)} />
      )}
    </PageSection>
  );
}
