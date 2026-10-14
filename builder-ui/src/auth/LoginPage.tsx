import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  TextInput,
} from '@patternfly/react-core';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from './AuthContext';
import './LoginPage.css';

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Wrong username or password.' : 'Could not log in. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="echo-login">
      <Card className="echo-login__card">
        <CardTitle component="h1">ECHO Builder</CardTitle>
        <CardBody>
          <Form onSubmit={onSubmit} aria-label="Log in">
            {error && <Alert variant="danger" isInline isPlain title={error} />}
            <FormGroup label="Username" isRequired fieldId="username">
              <TextInput id="username" name="username" value={username} onChange={(_e, v) => setUsername(v)} isRequired autoFocus autoComplete="username" />
            </FormGroup>
            <FormGroup label="Password" isRequired fieldId="password">
              <TextInput id="password" name="password" type="password" value={password} onChange={(_e, v) => setPassword(v)} isRequired autoComplete="current-password" />
            </FormGroup>
            <ActionGroup>
              <Button type="submit" variant="primary" isBlock isLoading={submitting} isDisabled={submitting || !username || !password}>
                Log in
              </Button>
            </ActionGroup>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}
