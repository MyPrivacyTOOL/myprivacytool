import { X } from "lucide-react";
import FootprintsIcon from "./FootprintsIcon";

// The Path (Chris, 2026-10-23): hexagons are ahead of you, footsteps are where you are, footprints are the trail behind you.
// This is the always-visible cue: what is behind you, the promise, and a remove button on each footprint.
// Wording follows decision "option A" (the promise covers the path you see and any scan you saved; anonymous server logs are separate).
// DRAFT COPY for Chris and counsel (MPC-6798); the whole component is off unless the footprints switch is on (src/config/footprints.ts).

export interface Footprint {
  id: string;
  label: string;
}

export const FOOTPRINTS_PROMISE = "Your footprints are behind you. Remove a step and its footprint goes. Close this session and your path is gone.";
export const FOOTPRINTS_SCOPE = "This covers your path and any scan you saved. Anonymous server logs are separate.";
export const FOOTPRINTS_EMPTY = "No footprints yet. Tap a hexagon to take your first step.";

interface Props {
  footprints: Footprint[];
  onRemove: (id: string) => void;
  className?: string;
}

export default function FootprintsCue({ footprints, onRemove, className = "" }: Props) {
  return (
    <section
      className={`mx-auto mt-6 w-full max-w-2xl rounded-xl border border-border bg-card px-4 py-4 ${className}`}
      aria-labelledby="footprints-heading"
      data-testid="footprints-cue"
    >
      <h3 id="footprints-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
        <FootprintsIcon className="h-7 w-7 shrink-0 text-primary" />
        Your footprints
      </h3>
      <p className="text-sm text-foreground" data-testid="footprints-promise">{FOOTPRINTS_PROMISE}</p>
      <p className="mb-3 text-xs text-muted-foreground" data-testid="footprints-scope">{FOOTPRINTS_SCOPE}</p>

      {footprints.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="footprints-empty">{FOOTPRINTS_EMPTY}</p>
      ) : (
        <ol className="flex flex-wrap gap-2" aria-label="Your footprints, oldest first" data-testid="footprints-trail">
          {footprints.map((f) => (
            <li key={f.id} className="flex items-center gap-1 rounded-full border border-border bg-background py-1 pl-3 pr-1 text-sm" data-testid={`footprint-${f.id}`}>
              <span>{f.label}</span>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                aria-label={`Remove footprint: ${f.label}`}
                title="Remove this footprint"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:h-7 sm:w-7"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
