import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, Loader2, LockKeyhole } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/backendClient';

export default function Login() {
  const { isAuthenticated, login, updatePassword, isPasswordRecovery, authError } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (isAuthenticated && !isPasswordRecovery) {
    return <Navigate to={location.state?.from?.pathname || '/'} replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (isPasswordRecovery) {
        await updatePassword(password);
        setMessage('Your password has been updated.');
      } else if (resetMode) {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (resetError) throw resetError;
        setMessage('Password reset instructions have been sent if this address has an account.');
      } else {
        await login(email, password);
      }
    } catch (submitError) {
      setError(submitError.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      icon={LockKeyhole}
      title="RCCA Tracker"
      subtitle="Sign in to your AEE production quality workspace"
      footer={null}
    >
      <form className="space-y-4" onSubmit={submit}>
        {!isPasswordRecovery && (
          <div>
            <label className="text-sm font-medium" htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="email" required value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        )}
        {!resetMode && (
          <div>
            <label className="text-sm font-medium" htmlFor="login-password">
              {isPasswordRecovery ? 'New password' : 'Password'}
            </label>
            <input id="login-password" type="password" autoComplete={isPasswordRecovery ? 'new-password' : 'current-password'}
              minLength={isPasswordRecovery ? 8 : undefined} required
              value={password} onChange={(event) => setPassword(event.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        )}
        {(error || authError) && (
          <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mr-2 inline h-4 w-4" />{error || authError.message}
          </div>
        )}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isPasswordRecovery ? 'Update password' : resetMode ? 'Send reset link' : 'Sign in'}
        </button>
        {!isPasswordRecovery && (
          <button type="button" className="w-full text-center text-sm text-blue-700 hover:underline"
            onClick={() => { setResetMode((value) => !value); setError(''); setMessage(''); }}>
            {resetMode ? 'Back to sign in' : 'Forgot password?'}
          </button>
        )}
      </form>
    </AuthLayout>
  );
}
