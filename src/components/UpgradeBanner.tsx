import { Link } from 'react-router-dom';
import type { PlanErrorInfo } from '../lib/planErrors';

export function UpgradeBanner({ info }: { info: PlanErrorInfo }) {
  if (!info.showUpgrade) {
    return <div className="warn-banner">{info.message}</div>;
  }
  return (
    <div className="upgrade-banner">
      <div className="upgrade-banner-text">
        <div className="upgrade-banner-title">{info.title}</div>
        <div className="upgrade-banner-message">{info.message}</div>
      </div>
      <Link to="/#pricing" className="btn primary upgrade-banner-cta">
        Upgrade plan
      </Link>
    </div>
  );
}
