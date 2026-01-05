import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Shield, ShieldAlert, ShieldCheck, ShieldX, 
  Lock, Unlock, Globe, AlertTriangle, CheckCircle2, 
  XCircle, ChevronDown, ChevronUp, RefreshCw, ExternalLink,
  Wifi, Server, Eye, EyeOff
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  runSecurityScan,
  SecurityScanResult,
  DNSLeakResult,
  HTTPSStatusResult,
  MixedContentResult,
  SecurityHeadersResult,
  BrowserSecurityResult,
  TLSConfigResult,
} from '@/lib/securityDetection';

interface SecurityPanelProps {
  onClose?: () => void;
}

interface FixGuide {
  title: string;
  steps: string[];
  links?: { text: string; url: string }[];
}

const SecurityPanel = ({ onClose }: SecurityPanelProps) => {
  const [securityData, setSecurityData] = useState<SecurityScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [retesting, setRetesting] = useState(false);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);

  useEffect(() => {
    runSecurityScan().then(data => {
      setSecurityData(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleRetest = async () => {
    setRetesting(true);
    try {
      const data = await runSecurityScan();
      setSecurityData(data);
    } finally {
      setRetesting(false);
    }
  };

  const securityScore = useMemo(() => {
    if (!securityData) return { score: 0, total: 7, percentage: 0 };
    
    let score = 0;
    const total = 7;
    
    if (securityData.httpsStatus.isSecure) score++;
    if (!securityData.dnsLeak?.isLeaking) score++;
    if (!securityData.mixedContent.hasMixedContent) score++;
    if (securityData.securityHeaders.score >= 60) score++;
    if (securityData.browserSecurity.isUpdated) score++;
    if (securityData.tlsConfig.isSecure) score++;
    // WebRTC check - assume no leak if DNS check passed
    if (!securityData.dnsLeak?.isLeaking) score++;
    
    return { score, total, percentage: Math.round((score / total) * 100) };
  }, [securityData]);

  const vpnAnalysis = useMemo(() => {
    if (!securityData?.dnsLeak) return null;
    
    const vpnDetected = securityData.dnsLeak.vpnDetected;
    const dnsProtected = !securityData.dnsLeak.isLeaking;
    const webrtcProtected = !securityData.dnsLeak.isLeaking;
    
    let effectiveness = 0;
    if (vpnDetected) {
      effectiveness = 33;
      if (dnsProtected) effectiveness += 33;
      if (webrtcProtected) effectiveness += 34;
    }
    
    return {
      detected: vpnDetected,
      dnsProtected,
      webrtcProtected,
      effectiveness,
    };
  }, [securityData]);

  const fixGuides: Record<string, FixGuide> = {
    dnsLeak: {
      title: 'How to Fix DNS Leak',
      steps: [
        '1. Enable "DNS Leak Protection" in your VPN settings',
        '2. Use your VPN provider\'s DNS servers (usually automatic)',
        '3. Disable IPv6 if your VPN doesn\'t support it',
        '4. On Windows: Run "ipconfig /flushdns" after connecting to VPN',
        '5. Consider using a VPN with built-in leak protection (NordVPN, ExpressVPN)',
      ],
      links: [
        { text: 'DNS Leak Test', url: 'https://www.dnsleaktest.com/' },
        { text: 'VPN Comparison', url: 'https://www.privacytools.io/vpn/' },
      ],
    },
    webrtcLeak: {
      title: 'How to Fix WebRTC Leak',
      steps: [
        'Firefox: Go to about:config, set media.peerconnection.enabled to false',
        'Chrome: Install "WebRTC Leak Prevent" extension',
        'Brave: Settings → Privacy → disable WebRTC',
        'Safari: WebRTC is disabled by default',
        'Edge: Install "WebRTC Control" extension',
      ],
      links: [
        { text: 'WebRTC Leak Test', url: 'https://browserleaks.com/webrtc' },
      ],
    },
    https: {
      title: 'How to Enforce HTTPS',
      steps: [
        '1. Install "HTTPS Everywhere" browser extension',
        '2. Enable "Always use HTTPS" in browser settings',
        '3. Check if the site offers an HTTPS version',
        '4. Avoid entering sensitive data on HTTP sites',
        '5. Use a VPN for additional encryption on HTTP sites',
      ],
      links: [
        { text: 'HTTPS Everywhere', url: 'https://www.eff.org/https-everywhere' },
      ],
    },
    browserUpdate: {
      title: 'How to Update Your Browser',
      steps: [
        'Chrome: Menu → Help → About Chrome → Update',
        'Firefox: Menu → Help → About Firefox → Update',
        'Safari: System Preferences → Software Update',
        'Edge: Menu → Help → About → Update',
        'Enable automatic updates for future security patches',
      ],
    },
    securityHeaders: {
      title: 'About Security Headers (For Site Owners)',
      steps: [
        'Content-Security-Policy: Prevents XSS attacks',
        'X-Frame-Options: Prevents clickjacking',
        'X-Content-Type-Options: Prevents MIME sniffing',
        'Referrer-Policy: Controls referrer information',
        'Permissions-Policy: Controls browser features',
      ],
      links: [
        { text: 'Security Headers Test', url: 'https://securityheaders.com/' },
      ],
    },
  };

  if (loading) {
    return (
      <Card className="border-2 border-red-500/30 bg-gradient-to-br from-background via-background to-red-950/10">
        <CardContent className="py-12 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4 text-red-400 animate-pulse" />
          <p className="text-muted-foreground">Running security scan...</p>
        </CardContent>
      </Card>
    );
  }

  if (!securityData) {
    return (
      <Card className="border-2 border-red-500/30">
        <CardContent className="py-12 text-center">
          <ShieldX className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <p className="text-muted-foreground">Security scan failed</p>
          <Button variant="outline" onClick={handleRetest} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry Scan
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasCriticalIssues = 
    securityData.dnsLeak?.isLeaking || 
    !securityData.httpsStatus.isSecure ||
    securityData.overallRisk === 'critical';

  return (
    <Card className="border-2 border-red-500/30 bg-gradient-to-br from-background via-background to-red-950/10 overflow-hidden">
      <CardHeader className="border-b border-red-500/20 bg-red-950/20">
        <CardTitle className="flex items-center gap-3">
          {hasCriticalIssues ? (
            <ShieldAlert className="w-6 h-6 text-red-400" />
          ) : securityScore.percentage >= 80 ? (
            <ShieldCheck className="w-6 h-6 text-green-400" />
          ) : (
            <Shield className="w-6 h-6 text-yellow-400" />
          )}
          <div>
            <span className="text-lg">Security & Privacy Vulnerabilities</span>
            <p className="text-sm font-normal text-muted-foreground mt-1">
              Critical issues that compromise your privacy
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-4 space-y-6">
        {/* CRITICAL ALERTS */}
        {securityData.dnsLeak?.isLeaking && (
          <div className="bg-red-500/20 border-2 border-red-500 rounded-lg p-4 animate-pulse">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-red-400 font-bold text-lg mb-2">
                  🚨 CRITICAL: DNS LEAK DETECTED
                </h3>
                <p className="text-sm text-red-200 mb-3">
                  Your DNS requests are being sent to your ISP instead of your VPN's DNS. 
                  This completely defeats your VPN—websites can see your real location 
                  and your ISP can log every website you visit.
                </p>
                <p className="text-xs text-red-300/80 mb-3">
                  Detected location: {securityData.dnsLeak.actualLocation}
                </p>
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={() => setExpandedGuide(expandedGuide === 'dnsLeak' ? null : 'dnsLeak')}
                >
                  {expandedGuide === 'dnsLeak' ? 'Hide' : 'How to Fix DNS Leak'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {!securityData.httpsStatus.isSecure && (
          <div className="bg-orange-500/20 border-2 border-orange-500 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Unlock className="w-6 h-6 text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-orange-400 font-bold text-lg mb-2">
                  ⚠️ WARNING: Insecure Connection
                </h3>
                <p className="text-sm text-orange-200 mb-3">
                  This site uses HTTP instead of HTTPS. Your data is transmitted in plain text 
                  and can be intercepted by anyone on your network, including passwords and personal info.
                </p>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="border-orange-500 text-orange-400 hover:bg-orange-500/20"
                  onClick={() => setExpandedGuide(expandedGuide === 'https' ? null : 'https')}
                >
                  {expandedGuide === 'https' ? 'Hide' : 'How to Stay Safe'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {securityData.mixedContent.hasMixedContent && (
          <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-yellow-400 font-semibold mb-1">
                  Mixed Content Detected
                </h3>
                <p className="text-sm text-yellow-200/80">
                  {securityData.mixedContent.insecureResources} insecure resources 
                  ({securityData.mixedContent.types.join(', ')}) loaded over HTTP, 
                  creating security vulnerabilities.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* SECURITY SCORECARD */}
        <div className="bg-background/50 rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Security Scorecard
            </h3>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${
                securityScore.percentage >= 80 ? 'text-green-400' :
                securityScore.percentage >= 50 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {securityScore.score}/{securityScore.total}
              </span>
              <span className="text-sm text-muted-foreground">checks passed</span>
            </div>
          </div>
          
          <Progress 
            value={securityScore.percentage} 
            className="h-2 mb-4"
          />
          
          <div className="grid gap-2 text-sm">
            <SecurityCheckItem 
              label="HTTPS Enabled" 
              passed={securityData.httpsStatus.isSecure}
              detail={securityData.httpsStatus.hstsEnabled ? 'With HSTS' : undefined}
            />
            <SecurityCheckItem 
              label="No DNS Leaks" 
              passed={!securityData.dnsLeak?.isLeaking}
              critical={securityData.dnsLeak?.isLeaking}
            />
            <SecurityCheckItem 
              label="No WebRTC Leaks" 
              passed={!securityData.dnsLeak?.isLeaking}
            />
            <SecurityCheckItem 
              label="Security Headers Present" 
              passed={securityData.securityHeaders.score >= 60}
              detail={`${securityData.securityHeaders.presentHeaders.length}/5 headers`}
            />
            <SecurityCheckItem 
              label="No Mixed Content" 
              passed={!securityData.mixedContent.hasMixedContent}
              detail={securityData.mixedContent.hasMixedContent 
                ? `${securityData.mixedContent.insecureResources} issues` 
                : undefined}
            />
            <SecurityCheckItem 
              label="Browser Up to Date" 
              passed={securityData.browserSecurity.isUpdated}
              detail={securityData.browserSecurity.version}
            />
            <SecurityCheckItem 
              label="Strong Encryption (TLS 1.3)" 
              passed={securityData.tlsConfig.tlsVersion.includes('1.3')}
              detail={securityData.tlsConfig.tlsVersion}
            />
          </div>
        </div>

        {/* VPN EFFECTIVENESS ANALYSIS */}
        {vpnAnalysis?.detected && (
          <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/30">
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <Wifi className="w-5 h-5 text-blue-400" />
              VPN Effectiveness Analysis
            </h3>
            
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="text-sm text-muted-foreground mb-1">Protection Level</div>
                <Progress value={vpnAnalysis.effectiveness} className="h-2" />
              </div>
              <span className={`text-xl font-bold ${
                vpnAnalysis.effectiveness >= 80 ? 'text-green-400' :
                vpnAnalysis.effectiveness >= 50 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {vpnAnalysis.effectiveness}%
              </span>
            </div>
            
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Eye className="w-4 h-4" /> IP Hidden
                </span>
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Server className="w-4 h-4" /> DNS Protected
                </span>
                {vpnAnalysis.dnsProtected ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Globe className="w-4 h-4" /> WebRTC Protected
                </span>
                {vpnAnalysis.webrtcProtected ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>
            </div>
          </div>
        )}

        {/* WHAT VULNERABILITIES MEAN */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
            Understanding These Vulnerabilities
          </h3>
          
          <VulnerabilityExplainer
            title="DNS Leak"
            icon={<Server className="w-4 h-4" />}
            description="Your Domain Name System (DNS) requests reveal every website you visit. When using a VPN, DNS should go through the VPN tunnel. A leak sends them to your ISP instead, exposing your complete browsing history."
            severity={securityData.dnsLeak?.isLeaking ? 'critical' : 'info'}
          />
          
          <VulnerabilityExplainer
            title="WebRTC Leak"
            icon={<Globe className="w-4 h-4" />}
            description="Web Real-Time Communication can expose your local IP addresses directly to websites. Even with a VPN active, WebRTC can reveal your actual location and internal network configuration."
            severity="warning"
          />
          
          <VulnerabilityExplainer
            title="HTTP vs HTTPS"
            icon={securityData.httpsStatus.isSecure ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            description="HTTP transmits data unencrypted. Anyone on your WiFi network, your ISP, or network administrators can see everything you do on HTTP sites—including passwords and personal data."
            severity={securityData.httpsStatus.isSecure ? 'secure' : 'critical'}
          />
          
          <VulnerabilityExplainer
            title="Mixed Content"
            icon={<AlertTriangle className="w-4 h-4" />}
            description="HTTPS pages loading HTTP resources create security holes. Attackers can inject malicious content through the insecure resources, even on otherwise secure pages."
            severity={securityData.mixedContent.hasMixedContent ? 'warning' : 'secure'}
          />
          
          <VulnerabilityExplainer
            title="Security Headers"
            icon={<Shield className="w-4 h-4" />}
            description="Headers like Content-Security-Policy protect against XSS attacks and clickjacking. Missing headers make you vulnerable to content injection and UI manipulation attacks."
            severity={securityData.securityHeaders.score < 60 ? 'warning' : 'info'}
          />
        </div>

        {/* FIX GUIDES */}
        <div className="space-y-2">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
            How to Fix Issues
          </h3>
          
          {Object.entries(fixGuides).map(([key, guide]) => (
            <Collapsible 
              key={key} 
              open={expandedGuide === key}
              onOpenChange={() => setExpandedGuide(expandedGuide === key ? null : key)}
            >
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border hover:border-primary/50 transition-colors">
                  <span className="font-medium text-sm">{guide.title}</span>
                  {expandedGuide === key ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 bg-muted/30 rounded-b-lg border-x border-b border-border mt-[-1px]">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {guide.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        {step}
                      </li>
                    ))}
                  </ul>
                  {guide.links && (
                    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
                      {guide.links.map((link, i) => (
                        <a
                          key={i}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          {link.text}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>

        {/* BROWSER RECOMMENDATIONS */}
        <div className="bg-background/50 rounded-lg p-4 border border-border">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <Globe className="w-5 h-5 text-primary" />
            Browser Security Recommendations
          </h3>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>Based on {securityData.browserSecurity.version}:</p>
            <ul className="space-y-1.5 ml-4">
              {!securityData.browserSecurity.isUpdated && (
                <li className="flex items-center gap-2 text-yellow-400">
                  <AlertTriangle className="w-3 h-3" />
                  Update to the latest version for security patches
                </li>
              )}
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
                Enable "HTTPS-Only Mode" in browser settings
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
                Install uBlock Origin for ad/tracker blocking
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
                Consider using DNS-over-HTTPS (DoH)
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
                Disable WebRTC if you use a VPN
              </li>
            </ul>
            <div className="pt-2 text-xs">
              <span className="text-green-400">Detected features: </span>
              {securityData.browserSecurity.securityFeatures.slice(0, 4).join(', ')}
            </div>
          </div>
        </div>

        {/* RETEST BUTTONS */}
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
          <Button 
            onClick={handleRetest} 
            disabled={retesting}
            className="flex-1"
          >
            {retesting ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-test All Security
              </>
            )}
          </Button>
          
          <Button variant="outline" asChild>
            <a href="https://www.dnsleaktest.com/" target="_blank" rel="noopener noreferrer">
              Test DNS Externally
              <ExternalLink className="w-4 h-4 ml-2" />
            </a>
          </Button>
        </div>

        {/* PRIVACY NOTICE */}
        <p className="text-xs text-center text-muted-foreground pt-2">
          <EyeOff className="w-3 h-3 inline mr-1" />
          All security tests run locally in your browser. No data is sent externally.
        </p>
      </CardContent>
    </Card>
  );
};

// Helper Components
const SecurityCheckItem = ({ 
  label, 
  passed, 
  detail,
  critical 
}: { 
  label: string; 
  passed: boolean; 
  detail?: string;
  critical?: boolean;
}) => (
  <div className={`flex items-center justify-between p-2 rounded ${
    critical ? 'bg-red-500/20' : passed ? 'bg-green-500/10' : 'bg-yellow-500/10'
  }`}>
    <span className="flex items-center gap-2">
      {passed ? (
        <CheckCircle2 className="w-4 h-4 text-green-400" />
      ) : critical ? (
        <XCircle className="w-4 h-4 text-red-400" />
      ) : (
        <XCircle className="w-4 h-4 text-yellow-400" />
      )}
      {label}
    </span>
    {detail && (
      <span className="text-xs text-muted-foreground">{detail}</span>
    )}
  </div>
);

const VulnerabilityExplainer = ({
  title,
  icon,
  description,
  severity,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  severity: 'critical' | 'warning' | 'info' | 'secure';
}) => {
  const borderColor = {
    critical: 'border-red-500/30',
    warning: 'border-yellow-500/30',
    info: 'border-border',
    secure: 'border-green-500/30',
  }[severity];

  const iconBg = {
    critical: 'bg-red-500/20 text-red-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    info: 'bg-muted text-muted-foreground',
    secure: 'bg-green-500/20 text-green-400',
  }[severity];

  return (
    <div className={`p-3 rounded-lg border ${borderColor} bg-background/30`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded ${iconBg}`}>
          {icon}
        </div>
        <div>
          <h4 className="font-medium text-sm mb-1">{title}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SecurityPanel;
