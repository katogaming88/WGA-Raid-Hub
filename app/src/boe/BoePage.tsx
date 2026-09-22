import { BoeReportForm } from './BoeReportForm';
import './boe.css';

// BoE sales (#1304 report form; the Open/Awaiting Payout/History lifecycle
// view is a separate issue). Guild-wide, open to anyone signed in or not.
export function BoePage() {
  return (
    <section className="page boe-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">BoE sales</h1>
        <p className="text-muted page-subtitle">Report a BoE find so officers can list and sell it.</p>
      </div>
      <BoeReportForm />
    </section>
  );
}
