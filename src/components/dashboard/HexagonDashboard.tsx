import { useState } from 'react';
import type { Hexagon, ScanResult } from '@/types/hexagon';
import { Button } from '@/components/ui/button';
import { useHexagonState } from '@/hooks/useHexagonState';
import { HexagonGrid } from '@/components/dashboard/HexagonGrid';
import { ProgressRing } from '@/components/dashboard/ProgressRing';
import { HitlConfirmModal } from '@/components/modals/HitlConfirmModal';
import { countSecured } from '@/components/dashboard/countSecured';
import { buildReportHtml } from '@/lib/honeycombReport';
import { RemediationPanel } from '@/components/modals/RemediationPanel';

const TOTAL = 54;

interface Props {
  initialData: ScanResult;
  title?: string;
}

export const HexagonDashboard = ({ initialData, title = 'Your Digital Footprint' }: Props) => {
  const { scanResult, handleConfirm, handleDispute } = useHexagonState(initialData);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'confirm' | 'remediate' | null>(null);
  const [fixedIds, setFixedIds] = useState<ReadonlySet<string>>(new Set());

  const active = scanResult.hexagons.find((h) => h.id === activeId) ?? null;
  const close = () => setPhase(null);

  const onSelect = (h: Hexagon) => {
    setActiveId(h.id);
    setPhase(h.status === 'guess' ? 'confirm' : 'remediate');
  };

  const onAnswer = (isMatch: boolean) => {
    if (!active) return;
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

  return (
    <div className="min-h-screen bg-white text-gray-900">
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={exportReport}>Export report</Button>
          <ProgressRing securedCount={secured} totalCount={TOTAL} />
        </div>
      </header>
      <HexagonGrid
        scanResult={scanResult}
        onConfirm={handleConfirm}
        onDispute={handleDispute}
        onSelect={onSelect}
        fixedIds={fixedIds}
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
