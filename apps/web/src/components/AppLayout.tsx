import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button } from './ui/Button';
import { cn } from '../lib/cn';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'rounded-lg px-3 py-1.5 text-sm transition-colors',
    isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
  );
}

function UserMenu() {
  const { user, loading, signOutUser } = useAuth();

  if (loading) {
    return <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-2" />;
  }

  if (!user) {
    return (
      <NavLink to="/login">
        <Button size="sm" variant="primary">
          Sign in
        </Button>
      </NavLink>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            className="size-7 rounded-full border border-border"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-7 items-center justify-center rounded-full border border-border bg-surface-2 text-xs text-muted">
            {(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="hidden text-sm text-muted sm:inline">
          {user.displayName ?? user.email}
        </span>
      </div>
      <Button size="sm" variant="ghost" onClick={() => void signOutUser()}>
        Sign out
      </Button>
    </div>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2">
              <span className="size-3 rounded-sm bg-accent" aria-hidden="true" />
              <span className="text-sm font-medium tracking-tight">Sign Mesh Maker</span>
            </NavLink>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navLinkClass}>
                Editor
              </NavLink>
              <NavLink to="/projects" className={navLinkClass}>
                My Projects
              </NavLink>
            </nav>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
