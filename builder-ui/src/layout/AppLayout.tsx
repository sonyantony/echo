import {
  Button,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  Page,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './AppLayout.css';

export function AppLayout() {
  const { user, logout } = useAuth();

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <MastheadLogo component={(props) => <Link {...props} to="/" />}>
            <span className="echo-brand">ECHO Builder</span>
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isFullHeight>
          <ToolbarContent>
            <ToolbarGroup align={{ default: 'alignEnd' }}>
              <ToolbarItem>
                <span data-testid="current-user">{user?.username}</span>
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    await logout();
                    // A full page load drops every cached query of the previous session.
                    window.location.assign('/login');
                  }}
                >
                  Log out
                </Button>
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  return (
    <Page masthead={masthead} isContentFilled>
      <Outlet />
    </Page>
  );
}
