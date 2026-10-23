import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from './auth/session';
import { Layout } from './components/Layout';
import { AdminClients } from './pages/AdminClients';
import { AdminRegions } from './pages/AdminRegions';
import { AdminSettings } from './pages/AdminSettings';
import { AdminUsers } from './pages/AdminUsers';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { NewOrder } from './pages/NewOrder';
import { Notifications } from './pages/Notifications';
import { OrderDetailPage } from './pages/OrderDetail';
import { OrdersList } from './pages/OrdersList';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  if (!ready) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user?.role !== 'PRINTORIA_ADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/orders" element={<OrdersList />} />
        <Route path="/orders/new" element={<NewOrder />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route
          path="/admin/clients"
          element={
            <RequireAdmin>
              <AdminClients />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/regions"
          element={
            <RequireAdmin>
              <AdminRegions />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAdmin>
              <AdminUsers />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <RequireAdmin>
              <AdminSettings />
            </RequireAdmin>
          }
        />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
