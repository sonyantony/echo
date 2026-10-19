import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { PublishModal } from './PublishModal';

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
});
afterEach(() => vi.unstubAllGlobals());

function renderModal() {
  const props = {
    flowId: 7,
    flowName: 'orders',
    beforePublish: vi.fn(async () => true),
    onPublished: vi.fn(),
    onInvalid: vi.fn(),
    onClose: vi.fn(),
  };
  render(<PublishModal {...props} />);
  return props;
}

describe('PublishModal', () => {
  it('saves first, then publishes with the message', async () => {
    const published = {
      publishedBy: 'designer',
      publishedAt: '',
      message: 'm',
      changed: true,
      targets: [{ target: 'git', name: 'Git', location: 'main', revision: 'abc12345def', changed: true }],
    };
    const { calls } = mockFetch({ 'POST /api/flows/7/publish': { status: 200, body: published } });
    const props = renderModal();

    await userEvent.type(screen.getByLabelText('Description'), 'Add mapping');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(props.beforePublish).toHaveBeenCalled();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ message: 'Add mapping' });
    expect(props.onPublished).toHaveBeenCalledWith(published);
  });

  it('hands validation problems back instead of publishing', async () => {
    const invalid = { valid: false, problems: [{ file: 'orders.camel.yaml', line: 3, message: 'bad' }] };
    mockFetch({ 'POST /api/flows/7/publish': { status: 422, body: invalid } });
    const props = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(props.onInvalid).toHaveBeenCalledWith(invalid);
    expect(props.onPublished).not.toHaveBeenCalled();
  });

  it('shows Git errors in the dialog', async () => {
    mockFetch({ 'POST /api/flows/7/publish': { status: 502, body: { detail: 'Git error: connection refused' } } });
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Git error: connection refused')).toBeInTheDocument();
  });

  it('does not show where the flow will be published', async () => {
    mockFetch({
      'GET /api/publish-targets': {
        status: 200,
        body: [{ id: 'git', name: 'Git', location: 'https://git.example.com/flows.git (branch main)' }],
      },
    });
    renderModal();
    expect(await screen.findByLabelText('Description')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Publish targets' })).not.toBeInTheDocument();
    expect(screen.queryByText(/git\.example\.com/)).not.toBeInTheDocument();
  });

  it('warns when no publish target is enabled', async () => {
    mockFetch({ 'GET /api/publish-targets': { status: 200, body: [] } });
    renderModal();
    expect(await screen.findByText('No publish target is enabled in application.yaml.')).toBeInTheDocument();
  });
});
