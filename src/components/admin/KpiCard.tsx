type Props = {
  label: string;
  value: string | number;
  hint?: string;
};

export function KpiCard({ label, value, hint }: Props) {
  return (
    <div className="admin-kpi">
      <p className="admin-kpi-label">{label}</p>
      <p className="admin-kpi-value">{value}</p>
      {hint ? <p className="admin-kpi-hint">{hint}</p> : null}
    </div>
  );
}
