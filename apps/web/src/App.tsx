import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AppLayout } from './components/AppLayout';
import { RequireAuth } from './components/RequireAuth';
import { NotFound } from './routes/NotFound';

/*
 * Routes load on demand. The editor pulls in three.js and the geometry
 * libraries, which someone signing in or looking through saved projects has no
 * use for; splitting here keeps that off the critical path for those screens.
 */
const Editor = lazy(() => import('./routes/Editor').then((m) => ({ default: m.Editor })));
const Login = lazy(() => import('./routes/Login').then((m) => ({ default: m.Login })));
const Projects = lazy(() => import('./routes/Projects').then((m) => ({ default: m.Projects })));

function RouteFallback() {
  return (
    <p className="py-24 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
      Loading
    </p>
  );
}

/*
 * Client-side routing works on hard refresh because wrangler.jsonc sets
 * assets.not_found_handling to "single-page-application".
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            element={
              <Suspense fallback={<RouteFallback />}>
                <AppLayout />
              </Suspense>
            }
          >
            <Route index element={<Editor />} />
            <Route path="login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route path="projects" element={<Projects />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
