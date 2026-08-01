import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';
import { ElevationStack } from '../components/ElevationStack';

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function Login() {
  const { user, loading, error, signIn } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/projects';

  if (user) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className="mx-auto grid max-w-4xl items-center gap-12 py-8 md:grid-cols-[1.1fr_1fr] md:gap-16 md:py-16">
      {/* Hero: the elevation drawing states the product's thesis before any copy does. */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          Elevation — typical
        </p>
        <ElevationStack className="mt-4" />
      </div>

      <div>
        <h1 className="font-mono text-2xl uppercase leading-[1.15] tracking-[0.02em] text-chalk">
          Flat art in,
          <br />
          <span className="text-signal">stacked color</span> out.
        </h1>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-graphite">
          Trace an image to vector, assign each color a print height, and export an
          STL for a multi-material printer. Everything runs in this browser.
        </p>

        <div className="mt-8 border-t border-rule pt-6">
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => void signIn()}
            disabled={loading}
          >
            <GoogleMark />
            Continue with Google
          </Button>

          <p className="mt-4 max-w-sm text-sm leading-relaxed text-graphite">
            Signing in saves your projects. The editor and STL export work without an
            account — start in the{' '}
            <Link to="/" className="text-chalk underline underline-offset-4 hover:text-signal">
              editor
            </Link>{' '}
            any time.
          </p>

          {error && (
            <p role="alert" className="mt-4 border-l-2 border-danger pl-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
