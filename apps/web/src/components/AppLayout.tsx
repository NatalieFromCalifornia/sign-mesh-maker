import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button } from './ui/Button';
import { cn } from '../lib/cn';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'relative py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors',
    // Active state is a survey tick under the label, not a filled pill.
    'after:absolute after:-bottom-px after:left-0 after:h-px after:w-full after:transition-colors',
    isActive
      ? 'text-chalk after:bg-signal'
      : 'text-graphite after:bg-transparent hover:text-chalk',
  );
}

/** Three ascending bars — the elevation stack reduced to a mark. */
function Wordmark() {
  return (
    <span className="flex items-end gap-[2px]" aria-hidden="true">
      <span className="h-1.5 w-1 bg-filament-3" />
      <span className="h-2.5 w-1 bg-filament-2" />
      <span className="h-3.5 w-1 bg-filament-1" />
    </span>
  );
}

function UserMenu() {
  const { user, loading, signOutUser } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return <div className="h-8 w-28 animate-pulse rounded-[3px] bg-bench-2" />;
  }

  if (!user) {
    // The login screen has its own sign-in control; a second one in the header
    // would compete with it.
    if (pathname === '/login') return null;

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
            className="size-6 rounded-full border border-rule"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-6 items-center justify-center rounded-full border border-rule bg-bench-2 font-mono text-[10px] text-graphite">
            {(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="hidden font-mono text-[11px] text-graphite sm:inline">
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
      <header className="sticky top-0 z-10 border-b border-rule bg-mat/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-5 sm:gap-8">
            <NavLink to="/" className="flex items-center gap-2.5">
              <Wordmark />
              {/* Below sm the mark carries the identity alone — the full
                  wordmark wrapped to three lines and blew out the header. */}
              <span className="hidden whitespace-nowrap font-mono text-xs uppercase tracking-[0.18em] text-chalk sm:inline">
                Sign Maker
              </span>
            </NavLink>
            <nav className="flex items-center gap-5">
              <NavLink to="/" end className={navLinkClass}>
                Editor
              </NavLink>
              <NavLink to="/projects" className={navLinkClass}>
                Projects
              </NavLink>
            </nav>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <Outlet />
      </main>
    </div>
  );
}
