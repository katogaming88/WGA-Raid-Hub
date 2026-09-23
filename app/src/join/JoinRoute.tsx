import { useParams } from 'react-router';
import { JoinPage } from './JoinPage';

export function JoinRoute() {
  return <JoinPage code={useParams()['code'] ?? ''} />;
}
