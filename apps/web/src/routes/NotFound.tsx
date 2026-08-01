import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export function NotFound() {
  return (
    <div className="py-24">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
        Off the datum
      </p>
      <h1 className="mt-3 font-mono text-lg uppercase tracking-[0.08em] text-chalk">
        No page at this address
      </h1>
      <Link to="/" className="mt-7 inline-block">
        <Button variant="secondary">Back to the editor</Button>
      </Link>
    </div>
  );
}
