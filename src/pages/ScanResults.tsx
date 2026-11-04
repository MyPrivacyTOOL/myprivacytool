/**
 * ScanResults Page
 * 
 * MPC-8454 + MPC-8455: Scan reveal flow
 * Fetches scan results from Supabase by scan_id (from URL query) and renders the interactive hexagon reveal
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ScanRevealFlow, { HexagonFinding } from '@/components/ScanRevealFlow';
import { Card } from '@/components/ui/card';
import Seo from '@/components/Seo';
import pageMeta from '@/data/pageMeta.json';

interface ScanData {
  scan_id: string;
  email: string;
  exposure_score: number;
  findings: HexagonFinding[];
}

export default function ScanResults() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scanId = searchParams.get('scan_id');

  useEffect(() => {
    if (!scanId) {
      setError('No scan ID provided');
      setLoading(false);
      return;
    }

    // Fetch scan results from Supabase
    const fetchScan = async () => {
      try {
        // Call our edge function / API to fetch scan + enrich with hexagon registry
        const response = await fetch(`/api/scans/${scanId}`);
        if (!response.ok) {
          throw new Error('Scan not found or expired');
        }
        
        const data = await response.json();
        
        // Transform findings from registry + scan results
        const enrichedFindings: HexagonFinding[] = data.findings.map((f: any) => ({
          id: f.id || `finding-${Math.random()}`,
          label: f.label,
          category: f.category,
          emoji: f.emoji || '📊',
          value: f.value || 'Found',
          riskLevel: f.risk_level || 'low',
          explanation: f.explanation || 'Your personal information was found.',
          remediation: f.remediation || 'Review and take action to remove this data.',
          confidence: f.confidence || 0.8,
          status: f.status || 'found',
        }));

        setScanData({
          scan_id: data.scan_id,
          email: data.email,
          exposure_score: data.exposure_score || 0,
          findings: enrichedFindings,
        });
      } catch (err) {
        setError((err as Error).message || 'Failed to load scan');
        console.error('Scan fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchScan();
  }, [scanId]);

  const handleHexagonClick = (finding: HexagonFinding) => {
    // Analytics: track hexagon click
    console.log('Hexagon clicked:', finding.id, finding.label);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white">
        <Seo {...pageMeta['/scan-results'] || { title: 'Your Privacy Scan Results', description: 'Loading...' }} path="/scan-results" />
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-gray-600">Loading your privacy scan...</p>
        </div>
      </div>
    );
  }

  if (error || !scanData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white px-4">
        <Seo {...pageMeta['/scan-results'] || { title: 'Your Privacy Scan Results', description: error || 'Error loading scan' }} path="/scan-results" />
        <Card className="max-w-md w-full p-6 border-2 border-red-200 bg-red-50">
          <h1 className="text-2xl font-bold text-red-900 mb-2">Scan not found</h1>
          <p className="text-red-700 mb-4">{error || 'Unable to load your scan results. The link may have expired.'}</p>
          <button
            onClick={() => navigate('/scan')}
            className="inline-block px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold"
          >
            Start a new scan →
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Seo 
        {...pageMeta['/scan-results'] || { title: 'Your Privacy Scan Results', description: `Your exposure score: ${scanData.exposure_score}/100` }} 
        path="/scan-results" 
      />
      <ScanRevealFlow
        scanId={scanData.scan_id}
        email={scanData.email}
        exposureScore={scanData.exposure_score}
        findings={scanData.findings}
        onHexagonClick={handleHexagonClick}
      />
    </div>
  );
}
