/**
 * MPC-8454 + MPC-8455 — Exposure Reveal Flow
 * 
 * Component: ScanRevealFlow
 * Purpose: Real-time privacy exposure reveal experience with interactive hexagons + risk guides
 * Data Model: Scan results from Supabase (scan_id, email, exposure_score, findings[])
 * 
 * Architecture:
 * - ExposureScoreSummary: Header with overall risk level + score badge
 * - HexagonGrid: 12 category hexagons with individual risk levels
 * - InteractiveHexagonTile: Click to reveal plain-language risk guide
 * - GuidePanel: Contextual advice for each finding
 * 
 * Design: Brand palette from MyPrivacyTOOL; risk-level color coding
 * Interaction: Click hexagon → slide-in guide with remediation steps
 */

import React, { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import Hexagon from './Hexagon';
import AliceHDBadge from './AliceHDBadge';
import HexagonExplanation from './HexagonExplanation';

// Type contracts
export interface HexagonFinding {
  id: string;
  label: string;
  category: string;
  emoji: string;
  value: string;
  riskLevel: 'clear' | 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  remediation?: string;
  confidence?: number;
  status: 'found' | 'clear' | 'not_checked';
}

export interface ScanRevealFlowProps {
  scanId: string;
  email: string;
  exposureScore: number;
  findings: HexagonFinding[];
  onHexagonClick?: (finding: HexagonFinding) => void;
}

// Risk level colors (from brand palette)
const RISK_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  clear: { bg: '#E8F5E9', border: '#4CAF50', text: '#1B5E20' },
  low: { bg: '#FFF9C4', border: '#FBC02D', text: '#F57F17' },
  medium: { bg: '#FFE0B2', border: '#FF9800', text: '#E65100' },
  high: { bg: '#FFCCBC', border: '#FF5722', text: '#BF360C' },
  critical: { bg: '#FFCDD2', border: '#F44336', text: '#B71C1C' },
};

// Hexagon category grouping
const CATEGORY_GROUPS = [
  { name: 'Device & Network', categories: ['device', 'network'] },
  { name: 'Privacy & Security', categories: ['privacy', 'security'] },
  { name: 'Fingerprinting & Tracking', categories: ['fingerprint', 'behavior'] },
  { name: 'Storage & Cookies', categories: ['storage'] },
  { name: 'Social & Identity', categories: ['social', 'profile'] },
  { name: 'Location & Locale', categories: ['language', 'orientation'] },
];

/**
 * ExposureScoreSummary
 * Header: Shows overall exposure score with risk badge + Alice introduction
 */
const ExposureScoreSummary: React.FC<{
  score: number;
  email: string;
  totalFindings: number;
}> = ({ score, email, totalFindings }) => {
  const riskBand =
    score >= 80
      ? { level: 'Critical', color: '#F44336', gradient: 'from-red-600 to-red-400' }
      : score >= 60
        ? { level: 'High', color: '#FF5722', gradient: 'from-orange-600 to-orange-400' }
        : score >= 40
          ? { level: 'Medium', color: '#FF9800', gradient: 'from-yellow-600 to-yellow-400' }
          : { level: 'Low', color: '#4CAF50', gradient: 'from-green-600 to-green-400' };

  return (
    <div className="w-full mb-8">
      <div className="flex items-start gap-6">
        {/* Alice character badge */}
        <div className="flex-shrink-0">
          <AliceHDBadge expression="greeting" />
        </div>

        {/* Score summary */}
        <Card className="flex-1 p-6 border-2" style={{ borderColor: riskBand.color }}>
          <p className="text-sm text-gray-600 mb-2">Privacy Exposure Report for</p>
          <p className="text-lg font-semibold text-gray-900 mb-4 break-all">{email}</p>

          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Exposure Score
              </p>
              <p className="text-4xl font-bold" style={{ color: riskBand.color }}>
                {score}/100
              </p>
              <p className="text-sm font-semibold mt-2" style={{ color: riskBand.color }}>
                {riskBand.level} Risk
              </p>
            </div>

            <div className="flex-1 border-l-2 pl-6" style={{ borderColor: riskBand.color }}>
              <p className="text-sm text-gray-700 mb-2">
                <strong>{totalFindings}</strong> findings across your digital footprint
              </p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Below, each hexagon shows one category of your exposure. Click any hexagon to see
                the details and what you can do.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

/**
 * HexagonGrid
 * Interactive grid of 12 category hexagons with color-coded risk levels
 */
const HexagonGridComponent: React.FC<{
  findings: HexagonFinding[];
  onHexagonClick: (finding: HexagonFinding) => void;
  selectedId?: string;
}> = ({ findings, onHexagonClick, selectedId }) => {
  // Group findings by category
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, HexagonFinding[]> = {};
    CATEGORY_GROUPS.forEach(group => {
      group.categories.forEach(cat => {
        groups[cat] = findings.filter(f => f.category === cat);
      });
    });
    return groups;
  }, [findings]);

  return (
    <div className="w-full">
      {CATEGORY_GROUPS.map(group => (
        <div key={group.name} className="mb-12">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            {group.name}
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {group.categories.map(cat => {
              const categoryFindings = groupedByCategory[cat] || [];
              const primaryFinding = categoryFindings[0];

              if (!primaryFinding) return null;

              const colors = RISK_COLORS[primaryFinding.riskLevel];
              const isSelected = selectedId === primaryFinding.id;

              return (
                <button
                  key={primaryFinding.id}
                  onClick={() => onHexagonClick(primaryFinding)}
                  className="flex flex-col items-center gap-3 p-4 rounded-lg transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2"
                  style={{
                    backgroundColor: colors.bg,
                    borderLeft: `4px solid ${colors.border}`,
                    borderRadius: '12px',
                    ...{ transform: isSelected ? 'scale(1.05)' : 'scale(1)' },
                  }}
                  title={`${primaryFinding.label}: ${primaryFinding.status}`}
                >
                  {/* Hexagon SVG or emoji hexagon */}
                  <div className="text-4xl">{primaryFinding.emoji}</div>

                  {/* Label + confidence */}
                  <div className="text-center">
                    <p className="text-sm font-semibold text-gray-900 leading-tight">
                      {primaryFinding.label}
                    </p>
                    {primaryFinding.confidence !== undefined && (
                      <p className="text-xs text-gray-600 mt-1">
                        {Math.round(primaryFinding.confidence * 100)}% confidence
                      </p>
                    )}
                  </div>

                  {/* Status indicator */}
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-full" style={{ backgroundColor: colors.border + '20' }}>
                    <span className="text-xs font-semibold" style={{ color: colors.border }}>
                      {primaryFinding.status === 'found'
                        ? '⚠️ Found'
                        : primaryFinding.status === 'clear'
                          ? '✓ Clear'
                          : '○ Not checked'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * GuidePanel
 * Slide-in panel with plain-language explanation + remediation steps
 */
const GuidePanel: React.FC<{
  finding: HexagonFinding | null;
  onClose: () => void;
}> = ({ finding, onClose }) => {
  if (!finding) return null;

  const colors = RISK_COLORS[finding.riskLevel];

  return (
    <div className="fixed bottom-0 left-0 right-0 top-0 z-40 bg-black bg-opacity-40 flex items-end transition-all duration-300">
      <div
        className="w-full max-w-2xl bg-white rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="sticky top-0 p-6 border-b-2 flex items-center justify-between"
          style={{ backgroundColor: colors.bg, borderColor: colors.border }}
        >
          <div className="flex items-center gap-4">
            <div className="text-5xl">{finding.emoji}</div>
            <div>
              <h3 className="text-2xl font-bold" style={{ color: colors.text }}>
                {finding.label}
              </h3>
              <p className="text-sm text-gray-600 capitalize">
                {finding.category} · {finding.status}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Current value */}
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">What we found</p>
            <p className="text-lg font-semibold text-gray-900">{finding.value}</p>
          </div>

          {/* Explanation */}
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">What it means</p>
            <p className="text-gray-700 leading-relaxed">{finding.explanation}</p>
          </div>

          {/* Risk level assessment */}
          <div className="p-4 rounded-lg" style={{ backgroundColor: colors.bg, borderLeft: `4px solid ${colors.border}` }}>
            <p className="text-sm font-semibold" style={{ color: colors.text }}>
              Risk Level: {finding.riskLevel.charAt(0).toUpperCase() + finding.riskLevel.slice(1)}
            </p>
            {finding.confidence !== undefined && (
              <p className="text-xs text-gray-600 mt-1">
                Confidence: {Math.round(finding.confidence * 100)}%
              </p>
            )}
          </div>

          {/* Remediation */}
          {finding.remediation && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">What you can do</p>
              <div
                className="p-4 rounded-lg border-l-4 bg-blue-50"
                style={{ borderColor: '#2196F3' }}
              >
                <p className="text-gray-700 leading-relaxed">{finding.remediation}</p>
              </div>
            </div>
          )}

          {/* Footer CTA */}
          <div className="pt-4 border-t space-y-3">
            <button
              onClick={onClose}
              className="w-full py-3 px-4 rounded-lg font-semibold bg-gray-100 text-gray-900 hover:bg-gray-200 transition-colors"
            >
              Got it, show me another
            </button>
            <a
              href="/guides"
              className="block w-full py-3 px-4 rounded-lg font-semibold text-center text-white transition-colors"
              style={{ backgroundColor: colors.border }}
            >
              View removal guides →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * ScanRevealFlow
 * Main component: coordinates hexagon grid + guide panel
 */
export const ScanRevealFlow: React.FC<ScanRevealFlowProps> = ({
  scanId,
  email,
  exposureScore,
  findings,
  onHexagonClick,
}) => {
  const [selectedFinding, setSelectedFinding] = useState<HexagonFinding | null>(null);

  const handleHexagonClick = (finding: HexagonFinding) => {
    setSelectedFinding(finding);
    onHexagonClick?.(finding);
  };

  return (
    <div className="w-full bg-gradient-to-br from-gray-50 to-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header with score */}
        <ExposureScoreSummary
          score={exposureScore}
          email={email}
          totalFindings={findings.length}
        />

        {/* Hexagon grid */}
        <HexagonGridComponent
          findings={findings}
          onHexagonClick={handleHexagonClick}
          selectedId={selectedFinding?.id}
        />

        {/* Guide panel (side-out) */}
        <GuidePanel finding={selectedFinding} onClose={() => setSelectedFinding(null)} />

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">
            Want a more detailed privacy report?
          </p>
          <a
            href="/pricing"
            className="inline-block px-6 py-3 rounded-lg font-semibold text-white transition-colors"
            style={{ backgroundColor: '#1976D2' }}
          >
            See what we can remove for you →
          </a>
        </div>
      </div>
    </div>
  );
};

export default ScanRevealFlow;
