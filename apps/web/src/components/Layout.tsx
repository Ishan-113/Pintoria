import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { ROLE_LABEL_SHORT } from '@pintoria/shared';

const CLIENT_NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/orders', label: 'Orders' },
  { to: '/notifications', label: 'Alerts' },
];

const STAFF_NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/orders', label: 'Orders' },
  { to: '/notifications', label: 'Alerts' },
];

const ADMIN_NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/orders', label: 'Orders' },
  { to: '/admin/clients', label: 'Clients' },
  { to: '/admin/regions', label: 'Regions' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/notifications', label: 'Alerts' },
];

export function Layout() {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  if (!user) return <Outlet />;

  const nav =
    user.role === 'PRINTORIA_ADMIN'
      ? ADMIN_NAV
      : user.role.startsWith('CLIENT_')
        ? CLIENT_NAV
        : STAFF_NAV;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Printoria<span>Portal</span>
        </div>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <strong>{user.fullName}</strong> <span className="muted">· {ROLE_LABEL_SHORT[user.role]}</span>
          </div>
          <button
            className="btn"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Log out
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
