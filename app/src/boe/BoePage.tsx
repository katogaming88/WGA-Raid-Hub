import { BoeLifecycle } from './BoeLifecycle';
import { BoeReportForm } from './BoeReportForm';
import './boe.css';

// BoE sales (#1304 report form, #1305 the lifecycle view). Guild-wide, open
// to anyone signed in or not: the report form works for a visitor, the
// Open/Awaiting Payout/History lifecycle only renders once signed in (#890),
// same as the current site.
export function BoePage() {
  return (
    <section className="page boe-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">BoE sales</h1>
        <p className="text-muted page-subtitle">Report a BoE find so officers can list and sell it.</p>
      </div>
      <BoeReportForm />
      <BoeLifecycle />
    </section>
  );
}
