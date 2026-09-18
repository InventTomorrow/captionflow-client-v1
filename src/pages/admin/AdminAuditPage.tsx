import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Log = {
  _id: string;
  action: string;
  targetType: string;
  targetId?: string;
  createdAt: string;
  actorId?: { name?: string; email?: string };
  meta?: Record<string, unknown>;
};

export function AdminAuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .get('/admin/audit-logs', { params: { limit: 100 } })
      .then((r) => setLogs(r.data.logs))
      .catch((e) => setError(e?.response?.data?.message || 'Admin only'));
  }, []);

  return (
    <div className="admin-page">
      <h1>Audit log</h1>
      <p className="muted">Append-only admin actions</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l._id}>
                <td>{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.actorId?.email || '-'}</td>
                <td>{l.action}</td>
                <td>
                  {l.targetType}
                  {l.targetId ? `:${l.targetId.slice(-6)}` : ''}
                </td>
                <td className="muted" style={{ maxWidth: 240, fontSize: '0.75rem' }}>
                  {l.meta ? JSON.stringify(l.meta) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
