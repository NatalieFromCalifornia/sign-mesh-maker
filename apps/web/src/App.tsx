import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AppLayout } from './components/AppLayout';
import { RequireAuth } from './components/RequireAuth';
import { Editor } from './routes/Editor';
import { Login } from './routes/Login';
import { NotFound } from './routes/NotFound';
import { Projects } from './routes/Projects';

/*
 * Client-side routing works on hard refresh because wrangler.jsonc sets
 * assets.not_found_handling to "single-page-application".
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
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
