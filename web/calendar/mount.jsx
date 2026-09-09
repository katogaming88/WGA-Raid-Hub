// Bridge between the vanilla multi-page site and these React islands.
// js/calendar.js (unconverted) still owns all data-fetching and Supabase
// writes and calls these globals instead of its own _renderCalGrid/
// _calRenderDayView once data is ready. Both islands share one root per
// container (rather than creating a fresh one every render) since that's
// what React itself expects -- calling createRoot() again on an
// already-mounted container both wastes work and prints a dev warning.
import { createRoot } from 'react-dom/client';
import CalendarGrid from './CalendarGrid.jsx';
import DayView from './DayView.jsx';

const roots = new WeakMap();

function mount(container, element) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(element);
}

window.mountCalendarGridReact = function (container, props) {
  mount(container, <CalendarGrid {...props} />);
};

window.mountDayViewReact = function (container, props) {
  mount(container, <DayView {...props} />);
};
