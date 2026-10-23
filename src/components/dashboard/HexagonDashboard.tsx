import { useEffect, useRef, useState } from 'react';
import type { Hexagon, ScanResult } from '@/types/hexagon';
import { Button } from '@/components/ui/button';
import { useHexagonState } from '@/hooks/useHexagonState';
import { HexagonGrid } from '@/components/dashboard/HexagonGrid';
import { ProgressRing } from '@/components/dashboard/ProgressRing';
import { HitlConfirmModal } from '@/components/modals/HitlConfirmModal';
import { countSecured } from '@/components/dashboard/countSecured';
import { TileProfile } from '@/components/dashboard/TileProfile';
import { canDispute } from '@/lib/identityConfirmation';
import { recordAnswer, recordShown, type TileInfo } from '@/lib/learning/events';
import { effectiveTile } from '@/utils/hexagonStyles';
import type { TileKind } from '@/lib/hexagonTile';
import { buildReportHtml } from '@/lib/honeycombReport';
import { RemediationPanel } from '@/components/modals/RemediationPanel';
import { footprintsCueEnabled } from '@/config/footprints';

const TOTAL = 54;

interface Props {
  initialData: ScanResult;
  title?: string;
  /** The visitor's first answer (confirm, reject or dispute). Fires once. */
  onStarted?: () => void;
  /** No "Is this you?" guess is left (or there were none). Fires once, with the number of hexagons on the page. */
  onAllAnswered?: (hexagonCount: number) => void;
}

export const HexagonDashboard = ({ initialData, title = 'Your Digital Footprint', onStarted, onAllAnswered }: Props) => {
  const { scanResult, handleConfirm, handleDispute } = useHexagonState(initialData);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'confirm' | 'remediate' | null>(null);
  const [fixedIds, setFixedIds] = useState<ReadonlySet<string>>(new Set());
  // The footprints path: the hexagons you have answered, in order. Held in this page only; it is gone when the page is.
  const [pathSteps, setPathSteps] = useState<string[]>([]);
  const pathOn = footprintsCueEnabled();
  const stepOn = (id: string) => setPathSteps((prev) => (prev.includes(id) ? prev : [...prev, id]));

  const started = useRef(false);
  const completed = useRef(false);
  const markStarted = () => {
    if (started.current) return;
    started.current = true;
    onStarted?.();
  };
  const guessesLeft = scanResult.hexagons.filter((h) => h.status === 'guess').length;
  useEffect(() => {
    if (guessesLeft > 0 || completed.current) return;
    completed.current = true;
    onAllAnswered?.(scanResult.hexagons.length);
  }, [guessesLeft, onAllAnswered, scanResult.hexagons.length]);

  // MPC-7915: tell the learning loop what was shown and answered. Off unless the build and the Worker both switch it on, and only with consent;
  // see lib/learning/events. Only web-scan tiles, never a finding's value, and a plain tap or a closed prompt is never sent.
  const tileInfo = (h: Hexagon): TileInfo => ({
    hexagonId: h.id, tileKind: effectiveTile(h, fixedIds.has(h.id)) ?? null, confidence: h.confidence_score ?? null, source: 'web-scan',
  });
  const offersAnswer = (h: Hexagon) => h.source === 'web-scan' && (h.status === 'guess' || canDispute(h));
  useEffect(() => {
    for (const h of scanResult.hexagons) if (offersAnswer(h)) void recordShown(tileInfo(h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanResult.hexagons]);
  const reportAnswer = (id: string, answer: 'yes_me' | 'not_me' | 'disputed' | 'kept') => {
    const h = scanResult.hexagons.find((x) => x.id === id);
    if (h && offersAnswer(h)) void recordAnswer(tileInfo(h), answer);
  };

  const active = scanResult.hexagons.find((h) => h.id === activeId) ?? null;
  const close = () => setPhase(null);

  const onSelect = (h: Hexagon) => {
    setActiveId(h.id);
    setPhase(h.status === 'guess' ? 'confirm' : 'remediate');
  };

  const onAnswer = (isMatch: boolean) => {
    if (!active) return;
    markStarted();
    reportAnswer(active.id, isMatch ? 'yes_me' : 'not_me');
    stepOn(active.id);
    handleConfirm(active.id, isMatch);
    // No: fade out (the false_positive is logged by the state hook). Yes: move to the action plan.
    setPhase(isMatch && (active.exposure || active.remediation) ? 'remediate' : null);
  };

  const onMarkFixed = () => {
    if (active) setFixedIds((prev) => new Set(prev).add(active.id));
    close();
  };

  const exportReport = () => {
    const html = buildReportHtml(scanResult.hexagons, {
      title, fixedIds, total: TOTAL, date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'digital-footprint-report.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  const secured = countSecured(scanResult.hexagons, fixedIds);
  const kinds = scanResult.hexagons.map((h) => effectiveTile(h, fixedIds.has(h.id))).filter((k): k is TileKind => !!k);

  return (
    <div className="min-h-screen bg-white text-gray-900">
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
          <Button variant="outline" onClick={exportReport}>Export report</Button>
          <ProgressRing securedCount={secured} totalCount={TOTAL} />
        </div>
      </header>
      <TileProfile kinds={kinds} />
      <HexagonGrid
        scanResult={scanResult}
        onConfirm={handleConfirm}
        onDispute={(id) => {
          markStarted();
          reportAnswer(id, 'disputed');
          stepOn(id);
          handleDispute(id);
        }}
        onKeep={(id) => reportAnswer(id, 'kept')}
        onSelect={onSelect}
        fixedIds={fixedIds}
        path={pathOn ? { steps: pathSteps, nextId: scanResult.hexagons.find((h) => h.status === 'guess' && !pathSteps.includes(h.id))?.id ?? null } : undefined}
      />
      {active && (
        <>
          <HitlConfirmModal hexagon={active} isOpen={phase === 'confirm'} onClose={close} onConfirm={onAnswer} />
          <RemediationPanel hexagon={active} isOpen={phase === 'remediate'} onClose={close} onMarkFixed={onMarkFixed} />
        </>
      )}
    </div>
    </div>
  );
};
