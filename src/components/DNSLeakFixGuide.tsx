import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldX,
  ArrowRight,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Monitor,
  Smartphone,
  Globe,
  Server,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Sparkles,
} from 'lucide-react';
import { detectDNSLeak, DNSLeakResult } from '@/lib/securityDetection';
import { cn } from '@/lib/utils';

interface DNSLeakFixGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLeak?: DNSLeakResult | null;
}

interface CopyButtonProps {
  text: string;
  label?: string;
}

const CopyButton = ({ text, label }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted rounded font-mono text-sm hover:bg-muted/80 transition-colors"
    >
      {label || text}
      {copied ? (
        <Check className="w-3 h-3 text-green-400" />
      ) : (
        <Copy className="w-3 h-3 text-muted-foreground" />
      )}
    </button>
  );
};

const DNSLeakFixGuide = ({ open, onOpenChange, currentLeak }: DNSLeakFixGuideProps) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'fixed' | 'still-leaking' | null>(null);
  const [activeTab, setActiveTab] = useState('vpn');

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await detectDNSLeak();
      setTestResult(result.isLeaking ? 'still-leaking' : 'fixed');
    } catch {
      setTestResult('still-leaking');
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-background via-background to-red-950/10 border-red-500/30">
        <DialogHeader className="border-b border-red-500/20 pb-4">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 bg-red-500/20 rounded-lg animate-pulse">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <span className="text-red-400">Fix Your DNS Leak Immediately</span>
              <DialogDescription className="text-muted-foreground mt-1">
                Your ISP can see every website you visit
              </DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* SUCCESS CELEBRATION */}
          {testResult === 'fixed' && (
            <div className="bg-green-500/20 border-2 border-green-500 rounded-lg p-6 text-center animate-in fade-in zoom-in duration-300">
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <ShieldCheck className="w-16 h-16 text-green-400" />
                  <Sparkles className="w-6 h-6 text-yellow-400 absolute -top-1 -right-1 animate-pulse" />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-green-400 mb-2">
                🎉 DNS Leak Fixed!
              </h3>
              <p className="text-green-200">
                Your DNS requests are now secure. Your ISP can no longer see which websites you visit.
              </p>
              <Button
                variant="outline"
                className="mt-4 border-green-500 text-green-400 hover:bg-green-500/20"
                onClick={() => onOpenChange(false)}
              >
                Close Guide
              </Button>
            </div>
          )}

          {testResult !== 'fixed' && (
            <>
              {/* VISUAL EXPLANATION */}
              <div className="space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Eye className="w-5 h-5 text-red-400" />
                  What's Happening Now
                </h3>
                
                <div className="grid md:grid-cols-2 gap-4">
                  {/* CURRENT STATE - BAD */}
                  <Card className="border-red-500/30 bg-red-950/20">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <XCircle className="w-5 h-5 text-red-400" />
                        <span className="font-medium text-red-400">Current (Leaking)</span>
                      </div>
                      
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          <span>Your Device</span>
                        </div>
                        <ArrowRight className="w-4 h-4 ml-4 text-red-400" />
                        <div className="flex items-center gap-2 text-red-300">
                          <Server className="w-4 h-4" />
                          <span>ISP DNS Servers</span>
                        </div>
                        <ArrowRight className="w-4 h-4 ml-4 text-red-400" />
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4" />
                          <span>Websites</span>
                        </div>
                      </div>
                      
                      <div className="mt-3 p-2 bg-red-500/20 rounded text-xs">
                        <Eye className="w-3 h-3 inline mr-1" />
                        ISP logs: "User visited gmail.com, reddit.com, ..."
                      </div>
                    </CardContent>
                  </Card>

                  {/* FIXED STATE - GOOD */}
                  <Card className="border-green-500/30 bg-green-950/20">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                        <span className="font-medium text-green-400">After Fixing</span>
                      </div>
                      
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          <span>Your Device</span>
                        </div>
                        <ArrowRight className="w-4 h-4 ml-4 text-green-400" />
                        <div className="flex items-center gap-2 text-green-300">
                          <Lock className="w-4 h-4" />
                          <span>VPN DNS (Encrypted)</span>
                        </div>
                        <ArrowRight className="w-4 h-4 ml-4 text-green-400" />
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4" />
                          <span>Websites</span>
                        </div>
                      </div>
                      
                      <div className="mt-3 p-2 bg-green-500/20 rounded text-xs">
                        <EyeOff className="w-3 h-3 inline mr-1" />
                        ISP sees: Encrypted VPN traffic only
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* FIX GUIDES */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="vpn">VPN Apps</TabsTrigger>
                  <TabsTrigger value="system">System</TabsTrigger>
                  <TabsTrigger value="browser">Browser</TabsTrigger>
                  <TabsTrigger value="dns">DNS Only</TabsTrigger>
                </TabsList>

                {/* VPN-SPECIFIC FIXES */}
                <TabsContent value="vpn" className="space-y-4">
                  <div className="grid gap-3">
                    <VPNGuide
                      name="NordVPN"
                      steps={[
                        'Open NordVPN app',
                        'Go to Settings → Advanced → DNS',
                        'Enable "Use NordVPN DNS"',
                        'Disconnect and reconnect to VPN',
                      ]}
                    />
                    <VPNGuide
                      name="ExpressVPN"
                      steps={[
                        'DNS leak protection is automatic',
                        'If leaking: Reinstall the app',
                        'Enable "Network Lock" (kill switch)',
                        'Try a different server location',
                      ]}
                    />
                    <VPNGuide
                      name="ProtonVPN"
                      steps={[
                        'Open ProtonVPN Settings',
                        'Go to Connection tab',
                        'Enable "DNS Leak Protection"',
                        'Reconnect to the VPN',
                      ]}
                    />
                    <VPNGuide
                      name="Mullvad"
                      steps={[
                        'Open Mullvad Settings',
                        'Go to DNS section',
                        'Select "Use custom DNS"',
                      ]}
                      dnsAddresses={['10.64.0.1']}
                    />
                    <VPNGuide
                      name="Other VPNs"
                      steps={[
                        'Look for "DNS Leak Protection" in settings',
                        'Enable VPN\'s own DNS servers',
                        'Disable "Split tunneling" if enabled',
                        'Or use system-level fix (next tab)',
                      ]}
                    />
                  </div>
                </TabsContent>

                {/* SYSTEM-LEVEL FIXES */}
                <TabsContent value="system" className="space-y-4">
                  <div className="grid gap-3">
                    <SystemGuide
                      os="Windows"
                      steps={[
                        'Open Network Settings',
                        'Click "Change adapter options"',
                        'Right-click your VPN adapter → Properties',
                        'Select "Internet Protocol Version 4 (TCP/IPv4)"',
                        'Click Properties → "Use the following DNS server addresses"',
                        'Enter your VPN\'s DNS or use secure DNS below',
                      ]}
                    />
                    <SystemGuide
                      os="macOS"
                      steps={[
                        'Open System Preferences → Network',
                        'Select your VPN connection',
                        'Click Advanced → DNS tab',
                        'Click + to add DNS servers',
                        'Add your VPN\'s DNS or use secure DNS below',
                        'Click OK → Apply',
                      ]}
                    />
                    <SystemGuide
                      os="Linux"
                      steps={[
                        'Edit /etc/resolv.conf (or use NetworkManager)',
                        'Add: nameserver [VPN DNS IP]',
                        'Or use: nameserver 1.1.1.1',
                        'Prevent overwriting: chattr +i /etc/resolv.conf',
                        'For systemd-resolved: edit /etc/systemd/resolved.conf',
                      ]}
                    />
                    
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm font-medium mb-2">Recommended Secure DNS Addresses:</p>
                      <div className="flex flex-wrap gap-2">
                        <CopyButton text="1.1.1.1" label="1.1.1.1 (Cloudflare)" />
                        <CopyButton text="9.9.9.9" label="9.9.9.9 (Quad9)" />
                        <CopyButton text="8.8.8.8" label="8.8.8.8 (Google)" />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* BROWSER-LEVEL FIXES */}
                <TabsContent value="browser" className="space-y-4">
                  <div className="grid gap-3">
                    <BrowserGuide
                      browser="Firefox"
                      steps={[
                        'Type about:config in address bar',
                        'Search for "network.trr.mode"',
                        'Set value to 3 (DoH only)',
                        'Search for "network.trr.uri"',
                        'Set to:',
                      ]}
                      configValue="https://mozilla.cloudflare-dns.com/dns-query"
                    />
                    <BrowserGuide
                      browser="Chrome"
                      steps={[
                        'Go to Settings → Privacy and Security',
                        'Click "Security"',
                        'Enable "Use secure DNS"',
                        'Select "Cloudflare" or "Google" from dropdown',
                        'Alternatively, use "Custom" with:',
                      ]}
                      configValue="https://1.1.1.1/dns-query"
                    />
                    <BrowserGuide
                      browser="Brave"
                      steps={[
                        'Go to Settings → Privacy and Security',
                        'Click "Security"',
                        'Enable "Use secure DNS"',
                        'Select provider or enter custom:',
                      ]}
                      configValue="https://dns.quad9.net/dns-query"
                    />
                    <BrowserGuide
                      browser="Edge"
                      steps={[
                        'Go to Settings → Privacy, search, and services',
                        'Scroll to "Security"',
                        'Enable "Use secure DNS"',
                        'Choose a service provider',
                      ]}
                    />
                  </div>
                </TabsContent>

                {/* DNS ONLY (NO VPN) */}
                <TabsContent value="dns" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    If you don't use a VPN, you can still protect DNS by using encrypted DNS providers:
                  </p>
                  
                  <div className="grid gap-3">
                    <DNSProvider
                      name="Cloudflare"
                      primary="1.1.1.1"
                      secondary="1.0.0.1"
                      doh="https://cloudflare-dns.com/dns-query"
                      features={['Fastest DNS', 'Privacy-focused', 'No logging']}
                    />
                    <DNSProvider
                      name="Quad9"
                      primary="9.9.9.9"
                      secondary="149.112.112.112"
                      doh="https://dns.quad9.net/dns-query"
                      features={['Blocks malware', 'Non-profit', 'Privacy-focused']}
                    />
                    <DNSProvider
                      name="OpenDNS"
                      primary="208.67.222.222"
                      secondary="208.67.220.220"
                      doh="https://doh.opendns.com/dns-query"
                      features={['Family filters available', 'Cisco owned', 'Reliable']}
                    />
                    <DNSProvider
                      name="Google DNS"
                      primary="8.8.8.8"
                      secondary="8.8.4.4"
                      doh="https://dns.google/dns-query"
                      features={['Very fast', 'Reliable', 'Note: Google logs queries']}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              {/* WHY THIS MATTERS */}
              <div className="bg-red-950/30 border border-red-500/20 rounded-lg p-4">
                <h3 className="font-semibold flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  Why This Matters
                </h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-red-400">•</span>
                    <span>DNS leaks reveal <strong>every website you visit</strong> (complete browsing history)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400">•</span>
                    <span>Your ISP logs <strong>when you visit</strong> and <strong>how often</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400">•</span>
                    <span>ISPs can <strong>sell this data to advertisers</strong> in many countries</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400">•</span>
                    <span>Governments can <strong>request logs without warrant</strong> in many jurisdictions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400">•</span>
                    <span>This is <strong>worse than IP leaks</strong> because it reveals detailed behavior patterns</span>
                  </li>
                </ul>
              </div>

              {/* TEST AGAIN */}
              <div className="flex flex-col items-center gap-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground text-center">
                  After making changes, reconnect your VPN and test again:
                </p>
                
                <div className="flex gap-3">
                  <Button
                    onClick={handleTest}
                    disabled={testing}
                    className={cn(
                      "min-w-[200px]",
                      testResult === 'still-leaking' && "bg-red-600 hover:bg-red-700"
                    )}
                  >
                    {testing ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Testing DNS...
                      </>
                    ) : testResult === 'still-leaking' ? (
                      <>
                        <XCircle className="w-4 h-4 mr-2" />
                        Still Leaking - Test Again
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4 mr-2" />
                        Test DNS Leak Now
                      </>
                    )}
                  </Button>
                  
                  <Button variant="outline" asChild>
                    <a
                      href="https://www.dnsleaktest.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      External Test
                      <ExternalLink className="w-4 h-4 ml-2" />
                    </a>
                  </Button>
                </div>

                {testResult === 'still-leaking' && (
                  <p className="text-sm text-red-400 text-center">
                    DNS is still leaking. Try a different method above, or try disconnecting and reconnecting your VPN.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Helper Components
const VPNGuide = ({
  name,
  steps,
  dnsAddresses,
}: {
  name: string;
  steps: string[];
  dnsAddresses?: string[];
}) => (
  <div className="p-3 bg-background/50 rounded-lg border border-border">
    <h4 className="font-medium mb-2 flex items-center gap-2">
      <Shield className="w-4 h-4 text-primary" />
      {name}
    </h4>
    <ol className="space-y-1 text-sm text-muted-foreground">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-primary font-medium">{i + 1}.</span>
          {step}
        </li>
      ))}
    </ol>
    {dnsAddresses && (
      <div className="mt-2 flex gap-2">
        {dnsAddresses.map((dns) => (
          <CopyButton key={dns} text={dns} />
        ))}
      </div>
    )}
  </div>
);

const SystemGuide = ({
  os,
  steps,
}: {
  os: string;
  steps: string[];
}) => (
  <div className="p-3 bg-background/50 rounded-lg border border-border">
    <h4 className="font-medium mb-2 flex items-center gap-2">
      <Monitor className="w-4 h-4 text-primary" />
      {os}
    </h4>
    <ol className="space-y-1 text-sm text-muted-foreground">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-primary font-medium">{i + 1}.</span>
          {step}
        </li>
      ))}
    </ol>
  </div>
);

const BrowserGuide = ({
  browser,
  steps,
  configValue,
}: {
  browser: string;
  steps: string[];
  configValue?: string;
}) => (
  <div className="p-3 bg-background/50 rounded-lg border border-border">
    <h4 className="font-medium mb-2 flex items-center gap-2">
      <Globe className="w-4 h-4 text-primary" />
      {browser}
    </h4>
    <ol className="space-y-1 text-sm text-muted-foreground">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-primary font-medium">{i + 1}.</span>
          {step}
        </li>
      ))}
    </ol>
    {configValue && (
      <div className="mt-2">
        <CopyButton text={configValue} />
      </div>
    )}
  </div>
);

const DNSProvider = ({
  name,
  primary,
  secondary,
  doh,
  features,
}: {
  name: string;
  primary: string;
  secondary: string;
  doh: string;
  features: string[];
}) => (
  <div className="p-4 bg-background/50 rounded-lg border border-border">
    <h4 className="font-medium mb-2">{name}</h4>
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Primary DNS:</p>
        <CopyButton text={primary} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Secondary DNS:</p>
        <CopyButton text={secondary} />
      </div>
    </div>
    <div className="mb-3">
      <p className="text-xs text-muted-foreground mb-1">DNS-over-HTTPS:</p>
      <CopyButton text={doh} />
    </div>
    <div className="flex flex-wrap gap-1">
      {features.map((feature) => (
        <span
          key={feature}
          className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded"
        >
          {feature}
        </span>
      ))}
    </div>
  </div>
);

export default DNSLeakFixGuide;
