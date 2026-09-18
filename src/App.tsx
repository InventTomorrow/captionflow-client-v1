import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { VerifyResetLinkPage } from './pages/VerifyResetLinkPage';
import { UploadPage } from './pages/UploadPage';
import { AppShell } from './components/AppShell';
import { AdminShell } from './components/admin/AdminShell';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminUserDetailPage } from './pages/admin/AdminUserDetailPage';
import { AdminPlansPage } from './pages/admin/AdminPlansPage';
import { AdminSubscriptionsPage } from './pages/admin/AdminSubscriptionsPage';
import { AdminProjectsPage } from './pages/admin/AdminProjectsPage';
import { AdminAnalyticsPage } from './pages/admin/AdminAnalyticsPage';
import { AdminSystemPage } from './pages/admin/AdminSystemPage';
import { AdminAuditPage } from './pages/admin/AdminAuditPage';

const EditorPage = lazy(() =>
  import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })),
);
// Loaded on demand: it draws the editor's template cards (kinetic thumbnails).
const AdminTemplatesPage = lazy(() =>
  import('./pages/admin/AdminTemplatesPage').then((m) => ({ default: m.AdminTemplatesPage })),
);

// Test-only: the browser half of the preview/export pixel-parity check
// (server/src/scripts/parity-check.ts). Never shipped to real users.
const PARITY_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_PARITY === '1';
const ParityPage = PARITY_ENABLED
  ? lazy(() => import('./pages/ParityPage').then((m) => ({ default: m.ParityPage })))
  : null;

// Dev-only: every template picker card on one page, drawn by the editor's own
// card component — what server/scripts/template-bg/shoot.mjs screenshots.
const TemplateGalleryPage = import.meta.env.DEV
  ? lazy(() => import('./pages/TemplateGalleryPage').then((m) => ({ default: m.TemplateGalleryPage })))
  : null;

// Dev-only: exercise the device-side media store (OPFS + probe + playback)
// without an account — what the Phase 1 smoke test drives.
const LocalMediaDevPage = import.meta.env.DEV
  ? lazy(() => import('./pages/LocalMediaDevPage').then((m) => ({ default: m.LocalMediaDevPage })))
  : null;

// Dev-only: on-device "text behind person" matte in a worker (personMatte.ts).
const MatteDevPage = import.meta.env.DEV
  ? lazy(() => import('./pages/MatteDevPage').then((m) => ({ default: m.MatteDevPage })))
  : null;

// Dev-only: live preview vs on-device export painter, side by side.
const CaptionLayoutDevPage = import.meta.env.DEV
  ? lazy(() => import('./pages/CaptionLayoutDevPage').then((m) => ({ default: m.CaptionLayoutDevPage })))
  : null;

// Dev-only: run an on-device (WebCodecs) export with sample captions.
const ExportDevPage = import.meta.env.DEV
  ? lazy(() => import('./pages/ExportDevPage').then((m) => ({ default: m.ExportDevPage })))
  : null;

function EditorRedirect() {
  const { id } = useParams();
  return <Navigate to={`/projects/${id}/editor`} replace />;
}

function Private({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  if (loading) return <div className="center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  if (loading) return <div className="center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin' && user.role !== 'support') {
    return <Navigate to="/projects/upload" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/verify" element={<VerifyResetLinkPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {TemplateGalleryPage && (
        <Route
          path="/dev/template-cards"
          element={
            <Suspense fallback={null}>
              <TemplateGalleryPage />
            </Suspense>
          }
        />
      )}
      {MatteDevPage && (
        <Route
          path="/dev/matte"
          element={
            <Suspense fallback={null}>
              <MatteDevPage />
            </Suspense>
          }
        />
      )}
      {CaptionLayoutDevPage && (
        <Route
          path="/dev/caption-layout"
          element={
            <Suspense fallback={null}>
              <CaptionLayoutDevPage />
            </Suspense>
          }
        />
      )}
      {ExportDevPage && (
        <Route
          path="/dev/export"
          element={
            <Suspense fallback={null}>
              <ExportDevPage />
            </Suspense>
          }
        />
      )}
      {LocalMediaDevPage && (
        <Route
          path="/dev/local-media"
          element={
            <Suspense fallback={null}>
              <LocalMediaDevPage />
            </Suspense>
          }
        />
      )}
      {ParityPage && (
        <Route
          path="/parity"
          element={
            <Suspense fallback={null}>
              <ParityPage />
            </Suspense>
          }
        />
      )}
      <Route
        path="/projects"
        element={
          <Private>
            <AppShell />
          </Private>
        }
      >
        <Route index element={<Navigate to="/projects/upload" replace />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path=":id/settings" element={<EditorRedirect />} />
        <Route path=":id/progress" element={<EditorRedirect />} />
        <Route
          path=":id/editor"
          element={
            <Suspense fallback={<div className="center">Loading editor…</div>}>
              <EditorPage />
            </Suspense>
          }
        />
      </Route>
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminShell />
          </AdminRoute>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/:id" element={<AdminUserDetailPage />} />
        <Route path="plans" element={<AdminPlansPage />} />
        <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
        <Route
          path="templates"
          element={
            <Suspense fallback={<div className="center">Loading…</div>}>
              <AdminTemplatesPage />
            </Suspense>
          }
        />
        <Route path="projects" element={<AdminProjectsPage />} />
        <Route path="analytics" element={<AdminAnalyticsPage />} />
        <Route path="system" element={<AdminSystemPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
