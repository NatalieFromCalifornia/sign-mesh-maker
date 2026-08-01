import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

/**
 * Guards routes that are meaningless without an account (currently only
 * Projects). The editor itself stays public on purpose — requirements §4
 * allows anonymous use of the whole pipeline and only gates saving.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="py-24 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
        Checking session
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}
