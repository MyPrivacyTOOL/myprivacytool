import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, ExternalLink, LogOut, Link2, Eye, Lock, Users, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  detectGoogleServices,
  detectMetaServices,
  detectMicrosoftServices,
  detectSocialMedia,
  detectCrossSiteTracking,
  detectEmailClients,
  type GoogleServicesResult,
  type MetaServicesResult,
  type MicrosoftServicesResult,
  type SocialMediaResult,
  type CrossSiteTrackingResult,
  type EmailClientsResult,
} from '@/lib/socialDetection';

interface SocialAccountsPanelProps {
  onClose?: () => void;
}

interface ServiceCardProps {
  name: string;
  icon: string;
  isLoggedIn: boolean;
  services?: string[];
  risk: 'low' | 'medium' | 'high' | 'critical';
}

const ServiceCard: React.FC<ServiceCardProps> = ({ name, icon, isLoggedIn, services, risk }) => {
  const riskColors = {
    low: 'text-green-400 border-green-500/30',
    medium: 'text-yellow-400 border-yellow-500/30',
    high: 'text-orange-400 border-orange-500/30',
    critical: 'text-red-400 border-red-500/30',
  };

  const riskBg = {
    low: 'bg-green-500/10',
    medium: 'bg-yellow-500/10',
    high: 'bg-orange-500/10',
    critical: 'bg-red-500/10',
  };

  return (
    <div className={`p-4 rounded-lg border ${isLoggedIn ? riskColors[risk] : 'border-muted/30 text-muted-foreground'} ${isLoggedIn ? riskBg[risk] : 'bg-muted/5'} transition-all hover:scale-105`}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <h4 className="font-semibold text-foreground">{name}</h4>
          <span className={`text-xs ${isLoggedIn ? riskColors[risk] : 'text-muted-foreground'}`}>
            {isLoggedIn ? '✅ Logged In' : '❌ Not Detected'}
          </span>
        </div>
        {isLoggedIn && (
          <div className={`px-2 py-1 rounded text-xs font-medium ${riskBg[risk]} ${riskColors[risk]}`}>
            {risk.toUpperCase()}
          </div>
        )}
      </div>
      {isLoggedIn && services && services.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          Services: {services.join(', ')}
        </div>
      )}
    </div>
  );
};

const TrackingTree: React.FC<{ name: string; icon: string; services: string[]; color: string }> = ({ name, icon, services, color }) => (
  <div className="mb-4">
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xl">{icon}</span>
      <span className={`font-semibold ${color}`}>{name}</span>
    </div>
    <div className="ml-6 border-l-2 border-dashed border-muted/40 pl-4 space-y-1">
      {services.map((service, i) => (
        <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className={`w-2 h-2 rounded-full ${color.replace('text-', 'bg-')}`} />
          {service}
        </div>
      ))}
    </div>
  </div>
);

export const SocialAccountsPanel: React.FC<SocialAccountsPanelProps> = ({ onClose }) => {
  const [googleData, setGoogleData] = useState<GoogleServicesResult | null>(null);
  const [metaData, setMetaData] = useState<MetaServicesResult | null>(null);
  const [microsoftData, setMicrosoftData] = useState<MicrosoftServicesResult | null>(null);
  const [socialData, setSocialData] = useState<SocialMediaResult | null>(null);
  const [crossSiteData, setCrossSiteData] = useState<CrossSiteTrackingResult | null>(null);
  const [emailData, setEmailData] = useState<EmailClientsResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const [google, meta, microsoft, social, crossSite, email] = await Promise.all([
        detectGoogleServices(),
        detectMetaServices(),
        detectMicrosoftServices(),
        detectSocialMedia(),
        detectCrossSiteTracking(),
        detectEmailClients(),
      ]);
      setGoogleData(google);
      setMetaData(meta);
      setMicrosoftData(microsoft);
      setSocialData(social);
      setCrossSiteData(crossSite);
      setEmailData(email);
      setIsLoading(false);
    };
    loadData();
  }, []);

  const calculatePrivacyScore = () => {
    let loggedInCount = 0;
    if (googleData?.isLoggedIn) loggedInCount++;
    if (metaData?.isLoggedIn) loggedInCount++;
    if (microsoftData?.isLoggedIn) loggedInCount++;
    if (socialData) loggedInCount += socialData.totalLoggedIn;

    if (crossSiteData?.ssoDetected && crossSiteData.linkedAccounts > 2) {
      return { level: 'critical', label: 'Critical', description: 'Complete browsing history exposed via SSO' };
    }
    if (loggedInCount >= 3) {
      return { level: 'high', label: 'High Risk', description: 'Extensive tracking network active' };
    }
    if (loggedInCount >= 1) {
      return { level: 'medium', label: 'Moderate', description: 'Some cross-site tracking possible' };
    }
    return { level: 'low', label: 'Excellent', description: 'Minimal cross-site tracking' };
  };

  const privacyScore = calculatePrivacyScore();

  const handleLogout = (service: string) => {
    const urls: Record<string, string> = {
      google: 'https://accounts.google.com/Logout',
      facebook: 'https://www.facebook.com/logout.php',
      microsoft: 'https://login.microsoftonline.com/logout',
    };
    if (urls[service]) {
      window.open(urls[service], '_blank');
      toast.success(`Opening ${service} logout page...`, {
        description: 'Complete the logout in the new tab',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-purple-950/40 via-background to-fuchsia-950/30 rounded-xl border border-purple-500/30 p-6 animate-pulse">
        <div className="h-8 bg-purple-500/20 rounded w-2/3 mb-4" />
        <div className="h-4 bg-purple-500/10 rounded w-1/2" />
      </div>
    );
  }

  const connectedPlatforms = socialData?.platforms.filter(p => p.loggedIn) || [];

  return (
    <div className="bg-gradient-to-br from-purple-950/40 via-background to-fuchsia-950/30 rounded-xl border border-purple-500/30 p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="text-center border-b border-purple-500/20 pb-4">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent flex items-center justify-center gap-2">
          <Link2 className="w-6 h-6 text-purple-400" />
          Your Connected Identity
        </h2>
        <p className="text-muted-foreground text-sm mt-1">Services tracking you across the web</p>
      </div>

      {/* Privacy Impact Score */}
      <div className={`p-4 rounded-lg border ${
        privacyScore.level === 'critical' ? 'border-red-500/50 bg-red-500/10' :
        privacyScore.level === 'high' ? 'border-orange-500/50 bg-orange-500/10' :
        privacyScore.level === 'medium' ? 'border-yellow-500/50 bg-yellow-500/10' :
        'border-green-500/50 bg-green-500/10'
      }`}>
        <div className="flex items-center gap-3">
          <Shield className={`w-8 h-8 ${
            privacyScore.level === 'critical' ? 'text-red-400' :
            privacyScore.level === 'high' ? 'text-orange-400' :
            privacyScore.level === 'medium' ? 'text-yellow-400' :
            'text-green-400'
          }`} />
          <div>
            <h3 className="font-bold text-lg">{privacyScore.label}</h3>
            <p className="text-sm text-muted-foreground">{privacyScore.description}</p>
          </div>
        </div>
      </div>

      {/* Logged-in Services Grid */}
      <div>
        <h3 className="text-lg font-semibold text-purple-300 mb-3 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Detected Services
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ServiceCard
            name="Google"
            icon="🔍"
            isLoggedIn={googleData?.isLoggedIn || false}
            services={googleData?.services}
            risk="high"
          />
          <ServiceCard
            name="Meta/Facebook"
            icon="📘"
            isLoggedIn={metaData?.isLoggedIn || false}
            services={metaData?.services}
            risk="high"
          />
          <ServiceCard
            name="Microsoft"
            icon="🪟"
            isLoggedIn={microsoftData?.isLoggedIn || false}
            services={microsoftData?.services}
            risk="medium"
          />
          {connectedPlatforms.slice(0, 6).map((platform) => (
            <ServiceCard
              key={platform.name}
              name={platform.name}
              icon="📱"
              isLoggedIn={platform.loggedIn}
              risk="medium"
            />
          ))}
        </div>
      </div>

      {/* Cross-Site Tracking Map */}
      {(googleData?.isLoggedIn || metaData?.isLoggedIn || microsoftData?.isLoggedIn) && (
        <div className="bg-background/50 rounded-lg p-4 border border-purple-500/20">
          <h3 className="text-lg font-semibold text-purple-300 mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Cross-Site Tracking Map
          </h3>
          
          {googleData?.isLoggedIn && googleData.services.length > 0 && (
            <TrackingTree
              name="Google Account"
              icon="🔍"
              services={[...googleData.services, "Third-party sites using 'Sign in with Google'", "Sites with Google Analytics (80%+ of web)"]}
              color="text-blue-400"
            />
          )}
          
          {metaData?.isLoggedIn && metaData.services.length > 0 && (
            <TrackingTree
              name="Meta Account"
              icon="📘"
              services={[...metaData.services, "Sites with Facebook Pixel", "Sites with Like/Share buttons"]}
              color="text-indigo-400"
            />
          )}
          
          {microsoftData?.isLoggedIn && microsoftData.services.length > 0 && (
            <TrackingTree
              name="Microsoft Account"
              icon="🪟"
              services={[...microsoftData.services, "LinkedIn network connections"]}
              color="text-cyan-400"
            />
          )}
        </div>
      )}

      {/* The Tracking Network - Educational */}
      <div className="bg-purple-900/20 rounded-lg p-4 border border-purple-500/20">
        <h3 className="text-lg font-semibold text-purple-300 mb-3 flex items-center gap-2">
          <Eye className="w-5 h-5" />
          The Tracking Network
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          When you're logged into Google, Facebook, or other major platforms, they can track your activity 
          across <span className="text-purple-300 font-semibold">millions of websites</span>—even sites you think are unrelated. 
          Every site with a 'Like' button, Google Analytics, or social login shares your activity with these companies.
        </p>
      </div>

      {/* What They Know */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-purple-300 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          What They Know About You
        </h3>
        
        {googleData?.isLoggedIn && (
          <div className="bg-blue-950/30 rounded-lg p-4 border border-blue-500/20">
            <h4 className="font-semibold text-blue-400 mb-2">🔍 Google (Logged In)</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Every YouTube video you watch</li>
              <li>• Every search you make</li>
              <li>• Every site with Google Analytics (80%+ of web)</li>
              <li>• Your location via Maps</li>
              <li>• Your emails and contacts</li>
            </ul>
          </div>
        )}
        
        {metaData?.isLoggedIn && (
          <div className="bg-indigo-950/30 rounded-lg p-4 border border-indigo-500/20">
            <h4 className="font-semibold text-indigo-400 mb-2">📘 Facebook/Meta (Logged In)</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Every site with Facebook Pixel</li>
              <li>• Every site with Like/Share buttons</li>
              <li>• Instagram activity</li>
              <li>• WhatsApp contacts (if linked)</li>
            </ul>
          </div>
        )}
        
        {microsoftData?.isLoggedIn && (
          <div className="bg-cyan-950/30 rounded-lg p-4 border border-cyan-500/20">
            <h4 className="font-semibold text-cyan-400 mb-2">🪟 Microsoft (Logged In)</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Office 365 documents</li>
              <li>• Outlook emails</li>
              <li>• LinkedIn professional network</li>
              <li>• Bing search history</li>
            </ul>
          </div>
        )}
      </div>

      {/* SSO Warning */}
      {crossSiteData?.ssoDetected && (
        <div className="bg-red-950/40 rounded-lg p-4 border border-red-500/40">
          <h3 className="text-lg font-semibold text-red-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Single Sign-On (SSO) Detected
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            You're using <span className="text-red-300 font-semibold">"Sign in with Google/Facebook"</span> on various sites. 
            While convenient, this means the provider knows <span className="text-red-300">every site you visit</span> that 
            uses their login. They can track your complete browsing history across all connected sites.
          </p>
          <p className="text-xs text-red-400/80 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Consider using separate passwords for each site instead
          </p>
        </div>
      )}

      {/* Incognito Warning */}
      <div className="bg-yellow-950/30 rounded-lg p-4 border border-yellow-500/30">
        <h4 className="font-semibold text-yellow-400 mb-2 flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Incognito Mode Warning
        </h4>
        <p className="text-sm text-muted-foreground">
          Being logged into these services <span className="text-yellow-300 font-semibold">defeats the purpose of incognito/private browsing</span>. 
          You're still tracked through your account, even if cookies are blocked.
        </p>
      </div>

      {/* Protection Recommendations */}
      <div className="bg-green-950/20 rounded-lg p-4 border border-green-500/20">
        <h3 className="text-lg font-semibold text-green-400 mb-3 flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Protection Recommendations
        </h3>
        <ul className="text-sm text-muted-foreground space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-green-400">•</span>
            Log out of services when not actively using them
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-400">•</span>
            Use Multi-Account Containers (Firefox) to isolate services
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-400">•</span>
            Use separate browsers for different activities
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-400">•</span>
            Avoid SSO - use unique passwords instead
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-400">•</span>
            Use temporary email services for signups
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-400">•</span>
            Consider privacy-focused alternatives (ProtonMail, DuckDuckGo)
          </li>
        </ul>
      </div>

      {/* Logout Buttons */}
      {(googleData?.isLoggedIn || metaData?.isLoggedIn || microsoftData?.isLoggedIn) && (
        <div className="border-t border-purple-500/20 pt-4">
          <h3 className="text-lg font-semibold text-purple-300 mb-3 flex items-center gap-2">
            <LogOut className="w-5 h-5" />
            Quick Logout Options
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            ⚠️ Logging out may sign you out of related services and affect saved preferences.
          </p>
          <div className="flex flex-wrap gap-2">
            {googleData?.isLoggedIn && (
              <Button
                variant="outline"
                size="sm"
                className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                onClick={() => handleLogout('google')}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Log Out of Google
              </Button>
            )}
            {metaData?.isLoggedIn && (
              <Button
                variant="outline"
                size="sm"
                className="border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10"
                onClick={() => handleLogout('facebook')}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Log Out of Facebook
              </Button>
            )}
            {microsoftData?.isLoggedIn && (
              <Button
                variant="outline"
                size="sm"
                className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                onClick={() => handleLogout('microsoft')}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Log Out of Microsoft
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SocialAccountsPanel;
