import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';


afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('Login', () => {
  it('sends a logged-out user to the login page', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401 } });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('shows an error for a wrong password', async () => {
    document.cookie = 'XSRF-TOKEN=abc';
    const { calls } = mockFetch({
      'GET /api/auth/me': { status: 401 },
      'POST /api/auth/login': { status: 401 },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.type(await screen.findByLabelText(/Username/), 'designer');
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Wrong username or password.')).toBeInTheDocument();
    const login = calls.find((c) => c.url === '/api/auth/login')!;
    expect(login.body).toEqual({ username: 'designer', password: 'wrong' });
    expect(login.headers.get('X-XSRF-TOKEN')).toBe('abc');
  });

  it('opens the start page after logging in', async () => {
    document.cookie = 'XSRF-TOKEN=abc';
    mockFetch({
      'GET /api/auth/me': { status: 401 },
      'POST /api/auth/login': { status: 200, body: { username: 'designer', roles: ['DESIGNER'] } },
      'GET /api/flows': { status: 200, body: [] },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.type(await screen.findByLabelText(/Username/), 'designer');
    await userEvent.type(screen.getByLabelText(/Password/), 'designer');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Start with a flow')).toBeInTheDocument();
    expect(screen.getByTestId('current-user')).toHaveTextContent('designer');
    expect(screen.getByTestId('current-user').parentElement).toHaveTextContent('User: designer');
  });
});
