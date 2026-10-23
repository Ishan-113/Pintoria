import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ORDER_STATUS_LABELS } from '@pintoria/shared';
import type { OrderStatus } from '@pintoria/shared';
import * as api from '../api/endpoints';
import { useSession } from '../auth/session';
import { Banner, Card, Empty, ErrorText, StatusChip } from '../components/ui';

export function Dashboard() {
  const { user } = useSession();
  const [data, setData] = useState<api.Dashboard | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.dashboard().then(setData).catch(setError);
  }, []);

  if (error) return <ErrorText error={error} />;
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const statuses = Object.entries(data.countsByStatus) as [OrderStatus, number][];
  const queues: string[] = [];
  if (data.quotationsAwaitingDecision !== undefined)
    queues.push(`${data.quotationsAwaitingDecision} quotation(s) awaiting client decision`);
  if (data.posPendingVerification !== undefined)
    queues.push(`${data.posPendingVerification} PO(s) pending verification`);
  if (data.pendingInvites !== undefined)
    queues.push(`${data.pendingInvites} pending invitation(s)`);
  if (data.clientCount !== undefined)
    queues.push(`${data.clientCount} client(s)`);

  return (
    <div className="page">
      <h2>Welcome back, {user?.fullName.split(' ')[0]}</h2>

      {queues.length > 0 && (
        <Banner kind="info">
          {queues.join(' · ')}
        </Banner>
      )}

      <div className="grid-2">
        <Card title="Orders by stage">
          {statuses.length === 0 && <Empty>No orders yet.</Empty>}
          <div className="status-grid">
            {statuses.map(([status, count]) => (
              <Link key={status} className="status-tile" to={`/orders?status=${status}`}>
                <span className="count">{count}</span>
                <StatusChip status={status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Delayed stages (alert!)">
          {data.delayedOrders.length === 0 && <Empty>Nothing overdue. Nice.</Empty>}
          <ul className="delay-list">
            {data.delayedOrders.map((d) => (
              <li key={d.id}>
                <Link to={`/orders/${d.id}`}>
                  <strong>{d.orderNumber}</strong> — {d.title}
                </Link>
                <span className="tag red">
                  {d.overlyByHours}h over limit in {ORDER_STATUS_LABELS[d.status]}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Recent orders">
        {data.recentOrders.length === 0 && <Empty>No recent activity.</Empty>}
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Title</th>
              <th>Stage</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.recentOrders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to={`/orders/${o.id}`}>{o.orderNumber}</Link>
                </td>
                <td>{o.title}</td>
                <td>
                  <StatusChip status={o.status} />
                </td>
                <td>{new Date(o.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
