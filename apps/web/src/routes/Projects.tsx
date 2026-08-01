import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ElevationStack } from '../components/ElevationStack';
import { useAuth } from '../auth/AuthProvider';

/*
 * Reachable only through <RequireAuth>, so `user` is always set here.
 * Listing saved projects is phase 9; the Firestore query will key off
 * ownerUid + updatedAt, which firestore.indexes.json already covers.
 */
export function Projects() {
  const { user } = useAuth();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
        <h1 className="font-mono text-lg uppercase tracking-[0.08em] text-chalk">Projects</h1>
        <p className="font-mono text-[11px] text-graphite">
          {user?.email}
        </p>
      </div>

      {/* An empty screen is an invitation to act, so the primary action leads. */}
      <div className="grid items-center gap-10 py-16 md:grid-cols-[1fr_1.1fr] md:gap-16">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
            Nothing saved yet
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-graphite">
            Signs you save will land here with a preview, ready to reopen and re-cut.
            Saving arrives in phase 9 — your account and the rules protecting it are
            already live.
          </p>
          <Link to="/" className="mt-7 inline-block">
            <Button variant="primary">Start a sign</Button>
          </Link>
        </div>

        <div className="rounded-panel border border-dashed border-rule bg-bench/40 p-6">
          <ElevationStack />
        </div>
      </div>
    </div>
  );
}
