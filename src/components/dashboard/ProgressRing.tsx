interface Props {
  securedCount: number;
  totalCount: number;
}

const SIZE = 120;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// CK-8322: the ring shows a plain count of the tiles the scan could check, never a percentage or a score. The arc is only a picture
// of that count; the words are the count and "checked". ("Secured" claimed more than a read of, say, your device type can mean.)
export const ProgressRing = ({ securedCount, totalCount }: Props) => {
  const count = Math.max(Math.min(securedCount, totalCount), 0);
  const ratio = totalCount > 0 ? count / totalCount : 0;

  return (
    <div
      role="progressbar"
      aria-label="Checked"
      aria-valuemin={0}
      aria-valuemax={totalCount}
      aria-valuenow={count}
      aria-valuetext={`${count} ${count === 1 ? 'tile' : 'tiles'} checked`}
      className="relative inline-flex h-[120px] w-[120px] items-center justify-center"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden="true">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-gray-200" />
        <circle
          data-testid="progress-ring-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          className="stroke-green-500 transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none text-gray-900">{count}</span>
        <span className="mt-1 text-xs text-gray-500">checked</span>
      </div>
    </div>
  );
};
