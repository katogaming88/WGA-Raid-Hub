import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors';
import './data-state.css';

// Renders a read's loading and error states the same way everywhere, then the
// content once the data is there. The error box stays until the reader retries
// (#1101: errors are never swallowed, and stay until acted on).
export function DataState<T>({
  query,
  label,
  children
}: {
  query: UseQueryResult<T>;
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <p className="data-loading" role="status">
        Loading {label}…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div className="data-error" role="alert">
        <p>
          <strong>Couldn’t load {label}.</strong> {errorMessage(query.error)}
        </p>
        <button type="button" className="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}
