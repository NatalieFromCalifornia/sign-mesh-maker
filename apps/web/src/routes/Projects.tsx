import { Panel } from '../components/ui/Panel';
import { useAuth } from '../auth/AuthProvider';

/*
 * Reachable only through <RequireAuth>, so `user` is always set here.
 * Loading and rendering saved projects is phase 9 — the Firestore query will
 * key off ownerUid + updatedAt, which firestore.indexes.json already covers.
 */
export function Projects() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">My Projects</h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as {user?.displayName ?? user?.email}.
        </p>
      </div>

      <Panel>
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-fg">No saved projects</p>
          <p className="max-w-sm text-sm text-muted">
            Saving and loading projects arrives in phase 9. Your account and the
            Firestore rules protecting it are already live.
          </p>
        </div>
      </Panel>
    </div>
  );
}
