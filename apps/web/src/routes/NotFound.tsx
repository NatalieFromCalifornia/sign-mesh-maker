import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-sm text-muted">That page doesn’t exist.</p>
      <Link to="/">
        <Button variant="secondary">Back to the editor</Button>
      </Link>
    </div>
  );
}
