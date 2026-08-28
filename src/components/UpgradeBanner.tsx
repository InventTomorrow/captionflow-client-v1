import { useState } from 'react';
import type { PlanErrorInfo } from '../lib/planErrors';
import { PricingModal } from './PricingModal';

export function UpgradeBanner({ info }: { info: PlanErrorInfo }) {
  const [pricingOpen, setPricingOpen] = useState(false);

  if (!info.showUpgrade) {
    return <div className="warn-banner">{info.message}</div>;
  }
  return (
    <div className="upgrade-banner">
      <div className="upgrade-banner-text">
        <div className="upgrade-banner-title">{info.title}</div>
        <div className="upgrade-banner-message">{info.message}</div>
      </div>
      <button type="button" className="btn primary upgrade-banner-cta" onClick={() => setPricingOpen(true)}>
        Upgrade plan
      </button>
      <PricingModal open={pricingOpen} onClose={() => setPricingOpen(false)} reason={info} />
    </div>
  );
}
