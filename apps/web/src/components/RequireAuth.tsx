import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

/**
 * Guards routes that are meaningless without an account (currently only
 * "My Projects"). The editor itself stays public on purpose — requirements §4
 * allows anonymous use of the whole pipeline and only gates saving.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted">
        Checking your session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}
