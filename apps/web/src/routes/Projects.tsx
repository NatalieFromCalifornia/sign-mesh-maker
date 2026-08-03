import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectSummary } from '@sign-mesh-maker/shared';
import { Button } from '../components/ui/Button';
import { Panel } from '../components/ui/Panel';
import { ElevationStack } from '../components/ElevationStack';
import { useAuth } from '../auth/AuthProvider';
import { deleteProject, listProjects, renameProject } from '../lib/projects';
import { cn } from '../lib/cn';

function relativeTime(ms: number): string {
  if (!ms) return 'just now';
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
}

/*
 * Reachable only through <RequireAuth>, so `user` is always set here.
 * The listing query is ownerUid + updatedAt desc, which is exactly the
 * composite index declared in firestore.indexes.json.
 */
export function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      setProjects(await listProjects(user.uid));
      setError(null);
    } catch (cause) {
      setError('Your projects could not be loaded.');
      console.error('Project list failed', cause);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const commitRename = useCallback(
    async (id: string) => {
      const name = draftName.trim();
      setRenaming(null);
      if (!name) return;

      // Update in place first: the round trip is slower than the user's eye,
      // and a list that lags behind a confirmed edit reads as a failed one.
      setProjects((current) =>
        current?.map((p) => (p.id === id ? { ...p, name } : p)) ?? current,
      );
      try {
        await renameProject(id, name);
      } catch (cause) {
        setError('That project could not be renamed.');
        console.error('Rename failed', cause);
        void refresh();
      }
    },
    [draftName, refresh],
  );

  const remove = useCallback(
    async (project: ProjectSummary) => {
      // Deletion is irreversible and there is no undo, so it asks first.
      if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;

      setPending(project.id);
      try {
        await deleteProject(project.id);
        setProjects((current) => current?.filter((p) => p.id !== project.id) ?? current);
      } catch (cause) {
        setError('That project could not be deleted.');
        console.error('Delete failed', cause);
      } finally {
        setPending(null);
      }
    },
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
        <h1 className="font-mono text-lg uppercase tracking-[0.08em] text-chalk">Projects</h1>
        <p className="font-mono text-[11px] text-graphite">{user?.email}</p>
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {error}
        </p>
      )}

      {projects === null ? (
        <p className="py-16 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          Loading
        </p>
      ) : projects.length === 0 ? (
        <div className="grid items-center gap-10 py-12 md:grid-cols-[1fr_1.1fr] md:gap-16">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
              Nothing saved yet
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-graphite">
              Signs you save appear here with a preview, ready to reopen and re-cut.
            </p>
            <Link to="/" className="mt-7 inline-block">
              <Button variant="primary">Start a sign</Button>
            </Link>
          </div>
          <div className="rounded-panel border border-dashed border-rule bg-bench/40 p-6">
            <ElevationStack />
          </div>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Panel className={cn('h-full', pending === project.id && 'opacity-40')}>
                <div className="flex h-full flex-col gap-3">
                  <Link
                    to={`/?project=${project.id}`}
                    className="block overflow-hidden rounded-[3px] border border-rule bg-white"
                  >
                    {project.thumbnailDataUrl ? (
                      <img
                        src={project.thumbnailDataUrl}
                        alt=""
                        className="aspect-[4/3] w-full object-contain"
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-bench-2 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
                        No preview
                      </div>
                    )}
                  </Link>

                  {renaming === project.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => void commitRename(project.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(project.id);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      aria-label={`Rename ${project.name}`}
                      className="h-8 rounded-[3px] border border-rule-strong bg-mat px-2 text-sm text-chalk outline-none"
                    />
                  ) : (
                    <Link
                      to={`/?project=${project.id}`}
                      className="truncate text-sm text-chalk hover:text-signal"
                    >
                      {project.name}
                    </Link>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-graphite">
                      {relativeTime(project.updatedAt)}
                    </span>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDraftName(project.name);
                          setRenaming(project.id);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pending === project.id}
                        onClick={() => void remove(project)}
                      >
                        Delete
                      </Button>
                    </span>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
