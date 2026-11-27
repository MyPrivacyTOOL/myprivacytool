import { hasGuide, guidePath } from '../../../shared/hexagon-registry/guides.js';

// MPC-8733 #4: link a fix step to its full guide page (/guides/<id>/, a static page built at postbuild). Renders nothing when
// the hexagon has no approved guide, so no link ever points at a page that does not exist.
export default function GuideLink({ hexagonId }: { hexagonId: string }) {
  if (!hasGuide(hexagonId)) return null;
  return (
    <p className="text-sm mt-3" data-testid="guide-link">
      <a href={guidePath(hexagonId)} className="underline text-primary focus-visible:outline focus-visible:outline-2">
        Read the full guide for this step
      </a>
      <span className="text-muted-foreground"> · After you change it, scan again to check it worked.</span>
    </p>
  );
}
