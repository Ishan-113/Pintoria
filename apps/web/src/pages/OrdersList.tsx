import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ORDER_STATUS_LABELS, ORDER_STATUSES } from '@pintoria/shared';
import * as api from '../api/endpoints';
import { useSession } from '../auth/session';
import { Empty, ErrBanner, Field, StatusChip } from '../components/ui';

export function OrdersList() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<api.OrderPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const status = params.get('status') ?? '';
  const search = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1');

  useEffect(() => {
    setLoading(true);
    api
      .listOrders({ status: status || undefined, search, page: String(page) || undefined })
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [status, search, page]);

  const canCreate = user?.role === 'CLIENT_REGIONAL';

  return (
    <div className="page">
      <div className="page-head">
        <h2>Orders</h2>
        {canCreate && (
          <Link className="btn primary" to="/orders/new">
            + New order
          </Link>
        )}
      </div>

      <div className="filters">
        <Field label="Search">
          <input
            value={search}
            placeholder="Order no., title, item…"
            onChange={(e) => {
              const next = new URLSearchParams(params);
              e.target.value ? next.set('q', e.target.value) : next.delete('q');
              next.delete('page');
              setParams(next, { replace: true });
            }}
          />
        </Field>
        <Field label="Stage">
          <select
            value={status}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              e.target.value ? next.set('status', e.target.value) : next.delete('status');
              next.delete('page');
              setParams(next, { replace: true });
            }}
          >
            <option value="">All stages</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ErrBanner error={error} />
      {loading && <p className="muted">Loading…</p>}

      {data && (
        <>
          {data.rows.length === 0 && !loading && <Empty>No orders match these filters.</Empty>}
          {data.rows.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Title</th>
                  <th>Stage</th>
                  <th>Qty</th>
                  <th>Delivery</th>
                  <th>Client / Region</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/orders/${o.id}`}>{o.orderNumber}</Link>
                    </td>
                    <td>{o.title}</td>
                    <td>
                      <StatusChip status={o.status} />
                    </td>
                    <td>
                      {o.quantity ?? '—'} {o.unit ?? ''}
                    </td>
                    <td>{o.requestedDeliveryDate?.slice(0, 10) ?? '—'}</td>
                    <td className="muted">
                      {o.client.name} · {o.region.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <button
              className="btn"
              disabled={page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('page', String(page - 1));
                setParams(next);
              }}
            >
              ← Prev
            </button>
            <span className="muted">
              Page {data.page} · {data.total} total
            </span>
            <button
              className="btn"
              disabled={data.page * data.pageSize >= data.total}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('page', String(page + 1));
                setParams(next);
              }}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
