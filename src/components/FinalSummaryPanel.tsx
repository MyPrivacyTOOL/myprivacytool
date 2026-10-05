import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Download, Share2, Shield, RotateCcw, ChevronRight, AlertTriangle, 
  CheckCircle, Eye, Trophy, Target, FileJson, BookOpen, Zap,
  Mouse, Keyboard, Users, ShieldAlert, Fingerprint, Database,
  Globe, Smartphone, FileText
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { HexagonData } from '@/lib/deviceDetection';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';
import { LanguagePrediction } from '@/lib/languagePredictor';
import EmailCaptureModal from '@/components/EmailCaptureModal';

interface FinalSummaryPanelProps {
  hexagons: HexagonData[];
  confirmedCount: number;
  fingerprint?: CompositeFingerprint | null;
  languagePrediction?: LanguagePrediction | null;
  onStartOver?: () => void;
}

interface CategoryStats {
  name: string;
  key: string;
  confirmed: number;
  total: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  criticalIssues: number;
  warnings: number;
}

interface PrivacyConcern {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium';
  category: string;
  fix?: string;
}

export default function FinalSummaryPanel({
  hexagons,
  confirmedCount,
  fingerprint,
  languagePrediction,
  onStartOver,
}: FinalSummaryPanelProps) {
  const [isExporting, setIsExporting] = useState(false);

  // Calculate category stats for all 8 categories
  const categoryStats = useMemo((): CategoryStats[] => {
    const categories: Record<string, { confirmed: number; total: number; critical: number; warnings: number }> = {
      device: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      network: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      privacy: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      language: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      orientation: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      fingerprint: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      storage: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      social: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      security: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
      behavior: { confirmed: 0, total: 0, critical: 0, warnings: 0 },
    };

    hexagons.forEach((hex) => {
      const cat = hex.category || 'device';
      if (categories[cat]) {
        categories[cat].total++;
        if (hex.confirmed) categories[cat].confirmed++;
        
        // Track critical issues and warnings
        const value = hex.value?.toLowerCase() || '';
        const label = hex.label?.toLowerCase() || '';
        
        if (value.includes('leak') || value.includes('critical') || value.includes('insecure')) {
          categories[cat].critical++;
        } else if (value.includes('warning') || value.includes('outdated') || value.includes('weak')) {
          categories[cat].warnings++;
        }
      }
    });

    return [
      {
        name: 'Device & Network',
        key: 'device',
        confirmed: categories.device.confirmed + categories.network.confirmed,
        total: categories.device.total + categories.network.total,
        icon: <Globe className="w-4 h-4" />,
        color: 'text-brand',
        bgColor: 'bg-brand-soft',
        criticalIssues: categories.device.critical + categories.network.critical,
        warnings: categories.device.warnings + categories.network.warnings,
      },
      {
        name: 'Language Intelligence',
        key: 'language',
        confirmed: categories.language.confirmed,
        total: categories.language.total,
        icon: <Globe className="w-4 h-4" />,
        color: 'text-brand',
        bgColor: 'bg-brand-soft',
        criticalIssues: categories.language.critical,
        warnings: categories.language.warnings,
      },
      {
        name: 'Device Orientation',
        key: 'orientation',
        confirmed: categories.orientation.confirmed,
        total: categories.orientation.total,
        icon: <Smartphone className="w-4 h-4" />,
        color: 'text-foreground',
        bgColor: 'bg-risk-mid-soft',
        criticalIssues: categories.orientation.critical,
        warnings: categories.orientation.warnings,
      },
      {
        name: 'Browser Fingerprint',
        key: 'fingerprint',
        confirmed: categories.fingerprint.confirmed,
        total: categories.fingerprint.total,
        icon: <Fingerprint className="w-4 h-4" />,
        color: 'text-foreground',
        bgColor: 'bg-risk-high-soft',
        criticalIssues: categories.fingerprint.critical,
        warnings: categories.fingerprint.warnings,
      },
      {
        name: 'Storage Analysis',
        key: 'storage',
        confirmed: categories.storage.confirmed,
        total: categories.storage.total,
        icon: <Database className="w-4 h-4" />,
        color: 'text-brand',
        bgColor: 'bg-brand-soft',
        criticalIssues: categories.storage.critical,
        warnings: categories.storage.warnings,
      },
      {
        name: 'Social Accounts',
        key: 'social',
        confirmed: categories.social.confirmed,
        total: categories.social.total,
        icon: <Users className="w-4 h-4" />,
        color: 'text-foreground',
        bgColor: 'bg-muted',
        criticalIssues: categories.social.critical,
        warnings: categories.social.warnings,
      },
      {
        name: 'Security Status',
        key: 'security',
        confirmed: categories.security.confirmed,
        total: categories.security.total,
        icon: <ShieldAlert className="w-4 h-4" />,
        color: 'text-foreground',
        bgColor: 'bg-risk-high-soft',
        criticalIssues: categories.security.critical,
        warnings: categories.security.warnings,
      },
      {
        name: 'Behavior Tracking',
        key: 'behavior',
        confirmed: categories.behavior.confirmed,
        total: categories.behavior.total,
        icon: <Mouse className="w-4 h-4" />,
        color: 'text-foreground',
        bgColor: 'bg-risk-mid-soft',
        criticalIssues: categories.behavior.critical,
        warnings: categories.behavior.warnings,
      },
    ].filter((cat) => cat.total > 0);
  }, [hexagons]);

  // Calculate top privacy concerns
  const topConcerns = useMemo((): PrivacyConcern[] => {
    const concerns: PrivacyConcern[] = [];
    
    hexagons.forEach((hex) => {
      if (!hex.confirmed) return;
      
      const value = hex.value?.toLowerCase() || '';
      const label = hex.label?.toLowerCase() || '';
      
      // DNS Leak
      if (label.includes('dns') && value.includes('leak')) {
        concerns.push({
          title: 'DNS Leak Detected',
          description: 'Your DNS requests expose your browsing history to your ISP',
          severity: 'critical',
          category: 'security',
          fix: 'Enable DNS leak protection in your VPN settings',
        });
      }
      
      // WebRTC Leak
      if (label.includes('webrtc') && value.includes('leak')) {
        concerns.push({
          title: 'WebRTC IP Leak',
          description: 'Your real IP is visible even with VPN enabled',
          severity: 'critical',
          category: 'security',
          fix: 'Disable WebRTC in browser settings or use a WebRTC blocker',
        });
      }
      
      // Canvas Fingerprint
      if (label.includes('canvas') && hex.category === 'fingerprint') {
        concerns.push({
          title: 'Canvas Fingerprint Tracked',
          description: 'Your browser can be uniquely identified across websites',
          severity: 'high',
          category: 'fingerprint',
          fix: 'Use Brave browser or enable fingerprint protection',
        });
      }
      
      // Logged-in Social
      if (hex.category === 'social' && !value.includes('not detected') && !value.includes('0 services')) {
        if (label.includes('google')) {
          concerns.push({
            title: 'Google Tracking Active',
            description: 'Google can track you across 80% of websites',
            severity: 'high',
            category: 'social',
            fix: 'Log out of Google when not in use',
          });
        }
        if (label.includes('meta') || label.includes('facebook')) {
          concerns.push({
            title: 'Meta Tracking Active',
            description: 'Facebook tracks you on sites with Like buttons',
            severity: 'high',
            category: 'social',
            fix: 'Use Facebook Container or log out',
          });
        }
      }
      
      // Behavior tracking
      if (hex.category === 'behavior' && label.includes('mouse')) {
        concerns.push({
          title: 'Mouse Tracking Active',
          description: 'Your movement patterns create a 97% unique signature',
          severity: 'medium',
          category: 'behavior',
        });
      }
    });
    
    // Sort by severity and take top 5
    const severityOrder = { critical: 0, high: 1, medium: 2 };
    return concerns
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, 5);
  }, [hexagons]);

  // Calculate strengths
  const strengths = useMemo(() => {
    const positives: string[] = [];
    
    hexagons.forEach((hex) => {
      if (!hex.confirmed) return;
      const value = hex.value?.toLowerCase() || '';
      const label = hex.label?.toLowerCase() || '';
      
      if (label.includes('protection') && !value.includes('none')) {
        positives.push('Fingerprint protection enabled');
      }
      if (label.includes('dns') && value.includes('protected')) {
        positives.push('DNS leak protection active');
      }
      if (label.includes('https') && value.includes('secure')) {
        positives.push('HTTPS encryption enabled');
      }
      if ((label.includes('google') || label.includes('facebook')) && value.includes('not detected')) {
        positives.push('Not logged into major tracking platforms');
      }
      if (label.includes('cookies') && value.includes('blocked')) {
        positives.push('Third-party cookies blocked');
      }
    });
    
    return [...new Set(positives)].slice(0, 5);
  }, [hexagons]);

  // Calculate overall privacy risk score (FINAL FORMULA); also returns each category's 0-100 risk (MPC-7173 baseline)
  const { overall: overallRisk, categoryRisk } = useMemo(() => {
    const weights = {
      device: 0.05,      // 5%
      privacy: 0.05,     // 5%
      language: 0.05,    // 5%
      orientation: 0.05, // 5%
      fingerprint: 0.25, // 25%
      storage: 0.10,     // 10%
      social: 0.20,      // 20%
      security: 0.15,    // 15%
      behavior: 0.10,    // 10%
    };

    let totalRisk = 0;
    const categoryRisk: Record<string, number> = {};
    
    categoryStats.forEach((cat) => {
      const catWeight = weights[cat.key as keyof typeof weights] || 0.05;
      const baseRisk = cat.total > 0 ? (cat.confirmed / cat.total) * 60 : 0;
      const criticalBonus = cat.criticalIssues * 20;
      const warningBonus = cat.warnings * 10;
      const catRisk = Math.min(baseRisk + criticalBonus + warningBonus, 100);
      categoryRisk[cat.key] = Math.round(catRisk);
      totalRisk += catRisk * catWeight;
    });

    // Add fingerprint uniqueness bonus
    if (fingerprint) {
      const fpRiskMap = { high: 20, medium: 10, low: 0 };
      totalRisk += fpRiskMap[fingerprint.totalRisk] || 0;
    }

    return { overall: Math.min(Math.round(totalRisk), 100), categoryRisk };
  }, [categoryStats, fingerprint]);

  // MPC-7120: offer the email capture once the scan is complete (this panel only renders after all hexagons are confirmed)
  const [showEmailModal, setShowEmailModal] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShowEmailModal(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  // Calculate uniqueness estimate
  const uniquenessEstimate = useMemo(() => {
    const totalDataPoints = confirmedCount;
    // Rough estimate: each confirmed data point increases uniqueness
    const uniqueness = Math.min(Math.pow(2, totalDataPoints / 4), 1000000);
    return Math.round(uniqueness);
  }, [confirmedCount]);

  const getRiskColor = (risk: number) => {
    if (risk >= 70) return 'text-foreground';
    if (risk >= 40) return 'text-foreground';
    return 'text-risk-low';
  };

  const getRiskBgColor = (risk: number) => {
    if (risk >= 70) return 'bg-risk-high';
    if (risk >= 40) return 'bg-risk-mid';
    return 'bg-risk-low';
  };

  const getRiskLabel = (risk: number) => {
    if (risk >= 70) return 'High Risk';
    if (risk >= 40) return 'Medium Risk';
    return 'Low Risk';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-foreground bg-risk-high/15 border-risk-high/30';
      case 'high': return 'text-foreground bg-risk-mid/15 border-risk-mid/30';
      case 'medium': return 'text-foreground bg-risk-mid/15 border-risk-mid/30';
      default: return 'text-muted-foreground bg-muted border-surface-border';
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      let yPos = margin;

      // PDF palette: RGB equivalents of the MPC-6906 light tokens in src/index.css
      // (jsPDF cannot read CSS variables, so keep these in sync with the tokens).
      const PDF = {
        ink: [26, 26, 26],            // --brand-near-black
        muted: [89, 89, 89],          // --muted-foreground
        card: [244, 244, 244],        // --brand-off-white / zebra rows
        track: [244, 244, 244],       // --brand-off-white
        brand: [30, 132, 73],         // --brand-ink (Deep Green)
        brandSoft: [233, 246, 238],   // --brand-soft
        riskHigh: [26, 26, 26],       // near black (no red text in print)
        riskHighSoft: [244, 244, 244],
        riskMid: [89, 89, 89],
        riskMidSoft: [244, 244, 244],
        riskOrange: [89, 89, 89],
        purple: [30, 132, 73],        // Deep Green
        cyan: [26, 26, 26],           // near black
      } satisfies Record<string, [number, number, number]> as Record<string, [number, number, number]>;

      // Helper function to add new page if needed
      const checkNewPage = (neededHeight: number) => {
        if (yPos + neededHeight > pageHeight - margin) {
          pdf.addPage();
          yPos = margin;
          return true;
        }
        return false;
      };

      // Header with gradient-like background
      pdf.setFillColor(...PDF.brandSoft);
      pdf.rect(0, 0, pageWidth, 45, 'F');
      
      // Title
      pdf.setTextColor(...PDF.brand); // Green
      pdf.setFontSize(24);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Digital Shadow Report', margin, 20);
      
      // Subtitle
      pdf.setTextColor(...PDF.muted); // Gray
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Complete Privacy Analysis - 46 Data Points', margin, 28);
      pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, 35);
      
      yPos = 55;

      // Overall Statistics Box
      pdf.setFillColor(...PDF.card);
      pdf.roundedRect(margin, yPos, pageWidth - 2 * margin, 35, 3, 3, 'F');
      
      // Stats grid
      const statsY = yPos + 12;
      const colWidth = (pageWidth - 2 * margin) / 4;
      
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      
      // Data Points
      pdf.setTextColor(...PDF.brand);
      pdf.text('46', margin + colWidth * 0 + 10, statsY);
      pdf.setFontSize(8);
      pdf.setTextColor(...PDF.muted);
      pdf.text('Data Points', margin + colWidth * 0 + 10, statsY + 8);
      
      // Risk Score
      pdf.setFontSize(18);
      pdf.setTextColor(...(overallRisk >= 70 ? PDF.riskHigh : overallRisk >= 40 ? PDF.riskMid : PDF.brand));
      pdf.text(String(overallRisk), margin + colWidth * 1 + 10, statsY);
      pdf.setFontSize(8);
      pdf.setTextColor(...PDF.muted);
      pdf.text('Risk Score', margin + colWidth * 1 + 10, statsY + 8);
      
      // Uniqueness
      pdf.setFontSize(14);
      pdf.setTextColor(...PDF.purple);
      pdf.text(`1:${uniquenessEstimate.toLocaleString()}`, margin + colWidth * 2 + 10, statsY);
      pdf.setFontSize(8);
      pdf.setTextColor(...PDF.muted);
      pdf.text('Uniqueness', margin + colWidth * 2 + 10, statsY + 8);
      
      // Exposure
      pdf.setFontSize(18);
      pdf.setTextColor(...PDF.cyan);
      pdf.text(`${Math.round((confirmedCount / 46) * 100)}%`, margin + colWidth * 3 + 10, statsY);
      pdf.setFontSize(8);
      pdf.setTextColor(...PDF.muted);
      pdf.text('Exposure', margin + colWidth * 3 + 10, statsY + 8);
      
      yPos += 45;

      // Risk Level Badge
      pdf.setFillColor(...(overallRisk >= 70 ? PDF.riskHighSoft : overallRisk >= 40 ? PDF.riskMidSoft : PDF.brandSoft));
      pdf.roundedRect(margin, yPos, 60, 10, 2, 2, 'F');
      pdf.setFontSize(9);
      pdf.setTextColor(...(overallRisk >= 70 ? PDF.riskHigh : overallRisk >= 40 ? PDF.riskMid : PDF.brand));
      pdf.text(`${getRiskLabel(overallRisk)}`, margin + 5, yPos + 7);
      
      yPos += 20;

      // Category Breakdown Section
      pdf.setTextColor(...PDF.brand);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Category Breakdown', margin, yPos);
      yPos += 8;

      // Category table
      const categoryData = categoryStats.map(cat => {
        const percentage = cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0;
        return [
          cat.name,
          `${cat.confirmed}/${cat.total}`,
          `${percentage}%`,
          cat.criticalIssues > 0 ? `${cat.criticalIssues} high priority` : '-',
          cat.warnings > 0 ? `${cat.warnings} warnings` : '-'
        ];
      });

      autoTable(pdf, {
        startY: yPos,
        head: [['Category', 'Detected', 'Accuracy', 'High priority', 'Warnings']],
        body: categoryData,
        theme: 'plain',
        headStyles: {
          fillColor: [...PDF.brandSoft],
          textColor: [...PDF.brand],
          fontStyle: 'bold',
          fontSize: 9
        },
        bodyStyles: {
          fillColor: [255, 255, 255],
          textColor: [...PDF.ink],
          fontSize: 8
        },
        alternateRowStyles: {
          fillColor: [...PDF.card]
        },
        margin: { left: margin, right: margin },
        columnStyles: {
          0: { cellWidth: 45 },
          1: { cellWidth: 25, halign: 'center' },
          2: { cellWidth: 25, halign: 'center' },
          3: { cellWidth: 30, halign: 'center' },
          4: { cellWidth: 30, halign: 'center' }
        }
      });

      yPos = (pdf as any).lastAutoTable.finalY + 15;

      // Draw a simple bar chart for categories
      checkNewPage(60);
      
      pdf.setTextColor(...PDF.brand);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Category Risk Visualization', margin, yPos);
      yPos += 10;

      const chartHeight = 8;
      const chartWidth = pageWidth - 2 * margin - 50;
      
      categoryStats.forEach((cat, i) => {
        const percentage = cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0;
        
        // Category name
        pdf.setFontSize(8);
        pdf.setTextColor(...PDF.muted);
        pdf.text(cat.name.substring(0, 15), margin, yPos + 5);
        
        // Background bar
        pdf.setFillColor(...PDF.track);
        pdf.roundedRect(margin + 50, yPos, chartWidth, chartHeight, 1, 1, 'F');
        
        // Progress bar
        const barColor = percentage >= 80 ? PDF.ink : percentage >= 50 ? PDF.muted : PDF.brand;
        pdf.setFillColor(...barColor);
        if (percentage > 0) {
          pdf.roundedRect(margin + 50, yPos, (chartWidth * percentage) / 100, chartHeight, 1, 1, 'F');
        }
        
        // Percentage text
        pdf.setTextColor(...barColor);
        pdf.text(`${percentage}%`, margin + 50 + chartWidth + 5, yPos + 5);
        
        yPos += chartHeight + 4;
      });

      yPos += 10;

      // Top Privacy Concerns
      if (topConcerns.length > 0) {
        checkNewPage(50);
        
        pdf.setTextColor(...PDF.riskHigh);
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Top Privacy Concerns', margin, yPos);
        yPos += 8;

        topConcerns.forEach((concern, i) => {
          checkNewPage(25);
          
          // Severity badge
          const severityColors: Record<string, number[]> = {
            critical: [...PDF.riskHigh],
            high: [...PDF.riskOrange],
            medium: [...PDF.brand]
          };
          const color = severityColors[concern.severity] || [...PDF.muted];
          
          pdf.setFillColor(...(color as [number, number, number]));
          pdf.setTextColor(255, 255, 255);
          pdf.roundedRect(margin, yPos, 20, 5, 1, 1, 'F');
          pdf.setFontSize(6);
          pdf.text(concern.severity.toUpperCase(), margin + 2, yPos + 3.5);
          
          // Title
          pdf.setTextColor(...PDF.ink);
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'bold');
          pdf.text(concern.title, margin + 25, yPos + 4);
          yPos += 7;
          
          // Description
          pdf.setTextColor(...PDF.muted);
          pdf.setFontSize(8);
          pdf.setFont('helvetica', 'normal');
          const descLines = pdf.splitTextToSize(concern.description, pageWidth - 2 * margin - 25);
          pdf.text(descLines, margin + 25, yPos);
          yPos += descLines.length * 4;
          
          // Fix recommendation
          if (concern.fix) {
            pdf.setTextColor(...PDF.cyan);
            pdf.setFontSize(7);
            pdf.text(`${concern.fix}`, margin + 25, yPos + 2);
            yPos += 6;
          }
          
          yPos += 5;
        });
      }

      // Strengths
      if (strengths.length > 0) {
        checkNewPage(40);
        
        pdf.setTextColor(...PDF.brand);
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('What You\'re Doing Well', margin, yPos);
        yPos += 8;

        strengths.forEach((strength) => {
          pdf.setTextColor(...PDF.brand);
          pdf.setFontSize(9);
          pdf.setFont('helvetica', 'normal');
          pdf.text(`• ${strength}`, margin + 5, yPos);
          yPos += 6;
        });
        
        yPos += 10;
      }

      // Action Plan
      checkNewPage(50);
      
      pdf.setTextColor(...PDF.cyan);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Prioritized Action Plan', margin, yPos);
      yPos += 8;

      const actionItems = [
        ...topConcerns.slice(0, 3).map(c => c.fix || `Address ${c.title.toLowerCase()}`),
        'Use a privacy-focused browser like Brave or Firefox',
        'Regularly clear cookies and browser data'
      ];

      actionItems.forEach((item, i) => {
        pdf.setFillColor(...PDF.cyan);
        pdf.circle(margin + 3, yPos - 1.5, 3, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'bold');
        pdf.text(String(i + 1), margin + 1.5, yPos);
        
        pdf.setTextColor(...PDF.ink);
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        const actionLines = pdf.splitTextToSize(item, pageWidth - 2 * margin - 15);
        pdf.text(actionLines, margin + 10, yPos);
        yPos += actionLines.length * 5 + 3;
      });

      // Footer
      checkNewPage(25);
      yPos = pageHeight - 25;
      
      pdf.setFillColor(...PDF.brandSoft);
      pdf.rect(0, yPos - 5, pageWidth, 30, 'F');
      
      pdf.setTextColor(...PDF.brand);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('🔒 100% Local Analysis', margin, yPos + 5);
      
      pdf.setTextColor(...PDF.muted);
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.text('All 46 data points were analyzed in your browser. Nothing was transmitted to any server.', margin, yPos + 12);
      pdf.text(`Report ID: ${Date.now().toString(36).toUpperCase()}`, margin, yPos + 18);

      // Save the PDF
      pdf.save(`digital-shadow-report-${Date.now()}.pdf`);
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('Failed to generate PDF. Please try the JSON export instead.');
    }
    
    setIsExporting(false);
  };

  const handleExportJSON = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalDataPoints: 46,
        confirmedDataPoints: confirmedCount,
        overallPrivacyRisk: overallRisk,
        riskLevel: getRiskLabel(overallRisk),
        uniqueness: `1 in ${uniquenessEstimate.toLocaleString()} browsers`,
        trackingExposure: `${Math.round((confirmedCount / 46) * 100)}%`,
      },
      categories: categoryStats.map((cat) => ({
        name: cat.name,
        detectedItems: cat.total,
        confirmedItems: cat.confirmed,
        criticalIssues: cat.criticalIssues,
        warnings: cat.warnings,
        accuracyRate: cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0,
      })),
      topConcerns: topConcerns.map(c => ({
        title: c.title,
        description: c.description,
        severity: c.severity,
        fix: c.fix,
      })),
      strengths,
      languageIntelligence: languagePrediction
        ? {
            predictedLanguage: languagePrediction.preferredLanguage,
            confidence: languagePrediction.preferredLanguageConfidence,
            profile: languagePrediction.userProfile,
          }
        : null,
      fingerprint: fingerprint
        ? {
            uniqueness: fingerprint.uniqueness,
            riskLevel: fingerprint.totalRisk,
            compositeHash: fingerprint.compositeHash,
          }
        : null,
      hexagons: hexagons.map((hex) => ({
        id: hex.id,
        label: hex.label,
        value: hex.value,
        confidence: hex.confidence,
        confirmed: hex.confirmed,
        category: hex.category,
      })),
      privacyNote: 'This report was generated locally in your browser. No data was sent to any server.',
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digital-shadow-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = () => {
    const shareText = `🎯 My Complete Digital Shadow - Final Report

📊 46 data points analyzed
🎯 ${confirmedCount} were accurate (${Math.round((confirmedCount / 46) * 100)}%)
Privacy Risk: ${overallRisk}/100 (${getRiskLabel(overallRisk)})
🔍 Uniqueness: 1 in ${uniquenessEstimate.toLocaleString()} browsers
${fingerprint ? `🔴 Fingerprint: ${fingerprint.uniqueness}` : ''}

Test yours at: ${window.location.origin}`;

    if (navigator.share) {
      navigator.share({
        title: 'My Digital Shadow Report',
        text: shareText,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(shareText);
      alert('Summary copied to clipboard!');
    }
  };

  return (
    <Card className="bg-surface/95 shadow-card border border-surface-border overflow-hidden">
      <CardHeader className="border-b border-risk-low/20 pb-4 bg-brand-soft">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-risk-low/15">
            <Target className="w-6 h-6 text-risk-low" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold text-risk-low flex items-center gap-2">
              🎯 Your Complete Digital Shadow
              <Badge className="bg-risk-mid/15 text-foreground border-risk-mid/30">
                <Trophy className="w-3 h-3 mr-1" />
                FINAL REPORT
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground font-normal">
              Complete analysis of 46 data points across 8 categories
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Overall Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-secondary rounded-lg border border-risk-low/20 text-center">
            <p className="text-2xl font-bold text-risk-low">46</p>
            <p className="text-xs text-muted-foreground">Data Points</p>
          </div>
          <div className="p-3 bg-secondary rounded-lg border border-risk-low/20 text-center">
            <p className={`text-2xl font-bold ${getRiskColor(overallRisk)}`}>{overallRisk}</p>
            <p className="text-xs text-muted-foreground">Risk Score</p>
          </div>
          <div className="p-3 bg-secondary rounded-lg border border-risk-low/20 text-center">
            <p className="text-lg font-bold text-foreground">1:{uniquenessEstimate.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Uniqueness</p>
          </div>
          <div className="p-3 bg-secondary rounded-lg border border-risk-low/20 text-center">
            <p className="text-2xl font-bold text-brand">{Math.round((confirmedCount / 46) * 100)}%</p>
            <p className="text-xs text-muted-foreground">Exposure</p>
          </div>
        </div>

        {/* Overall Risk Score Circle */}
        <div className="text-center p-6 bg-secondary rounded-xl border border-risk-low/20">
          <p className="text-muted-foreground text-sm mb-2">Overall Privacy Risk</p>
          <div className="relative inline-block">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="40" fill="none"
                stroke={overallRisk >= 70 ? 'hsl(var(--risk-high))' : overallRisk >= 40 ? 'hsl(var(--risk-mid))' : 'hsl(var(--risk-low))'}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${overallRisk * 2.51} 251`}
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-bold ${getRiskColor(overallRisk)}`}>
                {overallRisk}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold mt-4 ${getRiskBgColor(overallRisk)}/20 ${getRiskColor(overallRisk)} border border-current/30`}>
            {overallRisk >= 70 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
            {getRiskLabel(overallRisk)}
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-risk-low flex items-center gap-2">
            📊 Category Breakdown (8 Categories)
          </h4>
          <div className="grid gap-2">
            {categoryStats.map((cat) => {
              const percentage = cat.total > 0 ? Math.round((cat.confirmed / cat.total) * 100) : 0;
              return (
                <div key={cat.name} className={`flex items-center gap-3 p-3 ${cat.bgColor} rounded-lg border border-risk-low/20`}>
                  <div className={`p-1.5 rounded ${cat.bgColor} ${cat.color}`}>{cat.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${cat.color}`}>{cat.name}</span>
                      <div className="flex items-center gap-2">
                        {cat.criticalIssues > 0 && (
                          <Badge variant="outline" className="text-foreground border-risk-high/30 text-xs px-1.5">
                            {cat.criticalIssues} high priority
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{cat.confirmed}/{cat.total}</span>
                      </div>
                    </div>
                    <Progress value={percentage} className="h-1.5 bg-risk-low-soft" />
                  </div>
                  <span className={`text-sm font-mono ${percentage >= 80 ? 'text-foreground' : percentage >= 50 ? 'text-foreground' : 'text-risk-low'}`}>
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top 5 Privacy Concerns */}
        {topConcerns.length > 0 && (
          <div className="p-4 bg-risk-high-soft rounded-xl border border-risk-high/20">
            <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Top Privacy Concerns
            </h4>
            <div className="space-y-2">
              {topConcerns.map((concern, i) => (
                <div key={i} className={`p-3 rounded-lg border ${getSeverityColor(concern.severity)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{concern.title}</p>
                      <p className="text-xs opacity-70 mt-0.5">{concern.description}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs shrink-0 ${getSeverityColor(concern.severity)}`}>
                      {concern.severity}
                    </Badge>
                  </div>
                  {concern.fix && (
                    <div className="mt-2 flex items-center gap-1 text-xs opacity-80">
                      <Zap className="w-3 h-3" />
                      {concern.fix}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top 5 Strengths */}
        {strengths.length > 0 && (
          <div className="p-4 bg-risk-low-soft rounded-xl border border-risk-low/20">
            <h4 className="text-sm font-semibold text-risk-low mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              What You're Doing Well
            </h4>
            <ul className="space-y-2">
              {strengths.map((strength, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <ChevronRight className="w-4 h-4 text-risk-low flex-shrink-0 mt-0.5" />
                  {strength}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Plan */}
        <div className="p-4 bg-brand-soft rounded-xl border border-brand/20">
          <h4 className="text-sm font-semibold text-brand mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Prioritized Action Plan
          </h4>
          <ol className="space-y-2 text-sm text-foreground">
            {topConcerns.slice(0, 3).map((concern, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-brand/15 text-brand text-xs flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                {concern.fix || `Address ${concern.title.toLowerCase()}`}
              </li>
            ))}
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-brand/15 text-brand text-xs flex items-center justify-center flex-shrink-0">
                4
              </span>
              Use a privacy-focused browser like Brave or Firefox
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-brand/15 text-brand text-xs flex items-center justify-center flex-shrink-0">
                5
              </span>
              Regularly clear cookies and browser data
            </li>
          </ol>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-3">
          <Button variant="outline" onClick={handleExportPDF} disabled={isExporting} className="border-risk-low/30 text-foreground hover:bg-risk-low-soft">
            <FileText className="w-4 h-4 mr-2" />
            {isExporting ? 'Generating...' : 'Export PDF'}
          </Button>
          <Button variant="outline" onClick={handleExportJSON} className="border-brand/30 text-foreground hover:bg-muted">
            <FileJson className="w-4 h-4 mr-2" />
            Export JSON
          </Button>
          <Button variant="outline" onClick={handleShare} className="border-brand/30 text-foreground hover:bg-muted">
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        </div>

        <div className="flex gap-3">
          <Button variant="default" onClick={onStartOver} className="flex-1 bg-primary text-primary-foreground hover:bg-primary-hover hover:text-brand-white">
            <RotateCcw className="w-4 h-4 mr-2" />
            Start New Scan
          </Button>
          <Button variant="outline" onClick={() => window.open('https://privacyguides.org', '_blank')} className="border-border text-foreground hover:bg-muted">
            <BookOpen className="w-4 h-4 mr-2" />
            Protection Guide
          </Button>
        </div>

        {/* Privacy Notice */}
        <div className="flex items-center gap-3 p-3 bg-risk-low-soft rounded-lg border border-risk-low/20">
          <span className="text-xl">🔒</span>
          <p className="text-xs text-risk-low">
            <strong>100% Local:</strong> All 46 data points were analyzed in your browser. Nothing is transmitted unless you choose to email yourself the fix guide.
          </p>
        </div>
      </CardContent>
      {showEmailModal && (
        <EmailCaptureModal
          riskScore={overallRisk}
          categoryScores={categoryRisk}
          confirmedCount={confirmedCount}
          onClose={() => setShowEmailModal(false)}
          onSubmit={() => {}}
        />
      )}
    </Card>
  );
}
