import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ChevronDown, Trash2, RefreshCw, Shield, AlertTriangle, Info, HardDrive, Cookie, Database, Clock, Box, Eye, ExternalLink } from 'lucide-react';
import {
  detectAllStorage,
  clearAllStorage,
  formatBytes,
  AllStorageResult,
} from '@/lib/storageDetection';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { toast } from 'sonner';

// Known tracking key descriptions
const TRACKING_KEY_INFO: Record<string, string> = {
  '_ga': 'Google Analytics',
  '_gid': 'Google Analytics (24h)',
  '_gat': 'Google Analytics Throttle',
  '__utma': 'Universal Analytics',
  '__utmb': 'Universal Analytics Session',
  '__utmc': 'Universal Analytics Session',
  '__utmz': 'Universal Analytics Traffic Source',
  '_fbp': 'Facebook Pixel',
  '_fbc': 'Facebook Click ID',
  'fbq': 'Facebook Pixel Queue',
  'amplitude': 'Amplitude Analytics',
  'mixpanel': 'Mixpanel Analytics',
  'segment': 'Segment Analytics',
  'heap': 'Heap Analytics',
  'intercom': 'Intercom Chat',
  'hotjar': 'Hotjar Heatmaps',
  '_hj': 'Hotjar Session',
  'clarity': 'Microsoft Clarity',
  'optimizely': 'Optimizely A/B Testing',
  'abtasty': 'AB Tasty Testing',
  'adroll': 'AdRoll Advertising',
  'criteo': 'Criteo Retargeting',
  'doubleclick': 'Google DoubleClick Ads',
};

interface StorageBreakdownItem {
  name: string;
  value: number;
  color: string;
}

export default function StoragePanel() {
  const [storageData, setStorageData] = useState<AllStorageResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [storageChanges, setStorageChanges] = useState<number>(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadStorageData();
    
    // Check if monitoring was previously enabled
    const wasMonitoring = localStorage.getItem('myprivacy_storage_monitoring') === 'true';
    if (wasMonitoring) {
      setMonitoringEnabled(true);
    }
  }, []);

  // Monitor storage changes
  useEffect(() => {
    if (!monitoringEnabled) return;
    
    const startCounts = {
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
    };
    
    const interval = setInterval(() => {
      const currentCounts = {
        localStorage: localStorage.length,
        sessionStorage: sessionStorage.length,
      };
      
      const changes = 
        Math.abs(currentCounts.localStorage - startCounts.localStorage) +
        Math.abs(currentCounts.sessionStorage - startCounts.sessionStorage);
      
      if (changes > 0) {
        setStorageChanges(prev => prev + changes);
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [monitoringEnabled]);

  const loadStorageData = async () => {
    setIsLoading(true);
    try {
      const data = await detectAllStorage();
      setStorageData(data);
    } catch (error) {
      console.error('Failed to detect storage:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearStorage = async () => {
    setIsClearing(true);
    try {
      const result = await clearAllStorage();
      
      const clearedItems = [
        result.clearedCookies > 0 && `${result.clearedCookies} cookies`,
        result.clearedLocalStorage > 0 && `${result.clearedLocalStorage} localStorage items`,
        result.clearedSessionStorage > 0 && `${result.clearedSessionStorage} sessionStorage items`,
        result.clearedIndexedDBs > 0 && `${result.clearedIndexedDBs} IndexedDB databases`,
        result.clearedCaches > 0 && `${result.clearedCaches} caches`,
        result.unregisteredServiceWorkers > 0 && `${result.unregisteredServiceWorkers} service workers`,
      ].filter(Boolean);
      
      if (clearedItems.length > 0) {
        toast.success(`Storage cleared successfully! Removed: ${clearedItems.join(', ')}`);
      } else {
        toast.info('No storage to clear');
      }
      
      if (result.errors.length > 0) {
        toast.warning(`Some items could not be cleared: ${result.errors.join(', ')}`);
      }
      
      await loadStorageData();
    } catch (error) {
      toast.error('Failed to clear storage');
    } finally {
      setIsClearing(false);
    }
  };

  const toggleMonitoring = (enabled: boolean) => {
    setMonitoringEnabled(enabled);
    localStorage.setItem('myprivacy_storage_monitoring', enabled.toString());
    if (enabled) {
      setStorageChanges(0);
      toast.info('Storage monitoring enabled');
    } else {
      toast.info('Storage monitoring disabled');
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getRiskColor = (risk: 'high' | 'medium' | 'low') => {
    switch (risk) {
      case 'high': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'medium': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'low': return 'text-green-400 bg-green-500/10 border-green-500/30';
    }
  };

  const getRiskIcon = (risk: 'high' | 'medium' | 'low') => {
    switch (risk) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
    }
  };

  const getTrackingKeyDescription = (key: string): string => {
    const lowerKey = key.toLowerCase();
    for (const [pattern, description] of Object.entries(TRACKING_KEY_INFO)) {
      if (lowerKey.includes(pattern.toLowerCase())) {
        return description;
      }
    }
    return 'Unknown Tracker';
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-cyan-950/40 to-blue-900/20 border-cyan-500/30">
        <CardContent className="py-8 text-center">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center">
              <HardDrive className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
            <p className="text-cyan-300">Analyzing your browser storage...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!storageData) return null;

  // Calculate total storage
  const totalSizeBytes = 
    (storageData.localStorage.sizeKB * 1024) +
    (storageData.sessionStorage.sizeKB * 1024) +
    (storageData.indexedDB.estimatedSizeMB * 1024 * 1024) +
    (storageData.cacheStorage.estimatedSizeMB * 1024 * 1024);

  // Pie chart data
  const pieData: StorageBreakdownItem[] = [
    { name: 'Cookies', value: storageData.cookies.count * 100, color: '#f59e0b' },
    { name: 'LocalStorage', value: storageData.localStorage.sizeKB * 1024, color: '#06b6d4' },
    { name: 'SessionStorage', value: storageData.sessionStorage.sizeKB * 1024, color: '#10b981' },
    { name: 'IndexedDB', value: storageData.indexedDB.estimatedSizeMB * 1024 * 1024, color: '#8b5cf6' },
    { name: 'Cache', value: storageData.cacheStorage.estimatedSizeMB * 1024 * 1024, color: '#ec4899' },
  ].filter(item => item.value > 0);

  // All detected tracking keys
  const allTrackingKeys = [
    ...storageData.localStorage.trackingKeys,
    ...storageData.cookies.names.filter(n => 
      ['_ga', '_gid', '_fbp', 'amplitude', 'mixpanel', 'segment', 'hotjar', '_hj', 'clarity'].some(t => 
        n.toLowerCase().includes(t)
      )
    ),
  ];

  return (
    <Card className="bg-gradient-to-br from-cyan-950/40 to-blue-900/20 border-cyan-500/30 overflow-hidden">
      {/* Header */}
      <CardHeader className="border-b border-cyan-500/20 pb-4">
        <CardTitle className="flex items-center gap-3 text-cyan-400">
          <span className="text-2xl">💾</span>
          <div className="flex-1">
            <h3 className="text-lg sm:text-xl font-bold">Your Stored Data & Tracking Persistence</h3>
            <p className="text-sm text-cyan-300/70 font-normal">What websites are storing about you</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadStorageData}
            className="text-cyan-400 hover:text-cyan-300"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Storage Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Cookies Card */}
          <div className={`p-4 rounded-xl border ${getRiskColor(storageData.cookies.risk)}`}>
            <div className="flex items-center gap-2 mb-3">
              <Cookie className="w-5 h-5" />
              <h4 className="font-semibold">Cookies</h4>
              <span className="ml-auto text-lg">{getRiskIcon(storageData.cookies.risk)}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-mono">{storageData.cookies.count} cookies</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">First-party:</span>
                <span className="font-mono">{storageData.cookies.count - storageData.cookies.thirdParty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tracking:</span>
                <span className="font-mono text-red-400">{storageData.cookies.thirdParty}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground italic">
              These persist even after closing browser
            </p>
          </div>

          {/* LocalStorage Card */}
          <div className={`p-4 rounded-xl border ${getRiskColor(storageData.localStorage.risk)}`}>
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-5 h-5" />
              <h4 className="font-semibold">LocalStorage</h4>
              <span className="ml-auto text-lg">{getRiskIcon(storageData.localStorage.risk)}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items:</span>
                <span className="font-mono">{storageData.localStorage.itemCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size:</span>
                <span className="font-mono">{storageData.localStorage.sizeKB.toFixed(2)} KB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tracking keys:</span>
                <span className={`font-mono ${storageData.localStorage.hasTracking ? 'text-red-400' : 'text-green-400'}`}>
                  {storageData.localStorage.trackingKeys.length}
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground italic">
              Persists indefinitely until manually cleared
            </p>
          </div>

          {/* SessionStorage Card */}
          <div className={`p-4 rounded-xl border ${getRiskColor(storageData.sessionStorage.risk)}`}>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-5 h-5" />
              <h4 className="font-semibold">Session Storage</h4>
              <span className="ml-auto text-lg">{getRiskIcon(storageData.sessionStorage.risk)}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items:</span>
                <span className="font-mono">{storageData.sessionStorage.itemCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size:</span>
                <span className="font-mono">{storageData.sessionStorage.sizeKB.toFixed(2)} KB</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground italic">
              Cleared when you close the tab
            </p>
          </div>

          {/* IndexedDB Card */}
          <div className={`p-4 rounded-xl border ${getRiskColor(storageData.indexedDB.risk)}`}>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-5 h-5" />
              <h4 className="font-semibold">IndexedDB</h4>
              <span className="ml-auto text-lg">{getRiskIcon(storageData.indexedDB.risk)}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Databases:</span>
                <span className="font-mono">{storageData.indexedDB.databases.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Size:</span>
                <span className="font-mono">{storageData.indexedDB.estimatedSizeMB.toFixed(2)} MB</span>
              </div>
              {storageData.indexedDB.hasTracking && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tracking DBs:</span>
                  <span className="font-mono text-red-400">{storageData.indexedDB.trackingDatabases.length}</span>
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground italic">
              Complex data storage for web apps
            </p>
          </div>

          {/* Cache Storage Card */}
          <div className={`p-4 rounded-xl border ${getRiskColor(storageData.cacheStorage.risk)}`}>
            <div className="flex items-center gap-2 mb-3">
              <Box className="w-5 h-5" />
              <h4 className="font-semibold">Cache & Service Worker</h4>
              <span className="ml-auto text-lg">{getRiskIcon(storageData.cacheStorage.risk)}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className={`font-mono ${storageData.cacheStorage.serviceWorkerActive ? 'text-yellow-400' : 'text-green-400'}`}>
                  {storageData.cacheStorage.serviceWorkerActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Caches:</span>
                <span className="font-mono">{storageData.cacheStorage.cacheNames.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Size:</span>
                <span className="font-mono">{storageData.cacheStorage.estimatedSizeMB.toFixed(2)} MB</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground italic">
              Service workers enable offline functionality
            </p>
          </div>

          {/* Storage Quota Card */}
          <div className="p-4 rounded-xl border border-slate-500/30 bg-slate-500/10">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-5 h-5 text-slate-400" />
              <h4 className="font-semibold text-slate-300">Storage Quota</h4>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Used:</span>
                <span className="font-mono">{formatBytes(storageData.storageQuota.usage)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quota:</span>
                <span className="font-mono">{formatBytes(storageData.storageQuota.quota)}</span>
              </div>
              <Progress 
                value={storageData.storageQuota.percentUsed} 
                className="h-2 mt-2"
              />
              <p className="text-xs text-center text-muted-foreground">
                {storageData.storageQuota.percentUsed.toFixed(2)}% used
              </p>
            </div>
          </div>
        </div>

        {/* Total Storage Usage */}
        <div className="p-6 rounded-xl border border-cyan-500/30 bg-cyan-950/30">
          <h4 className="text-lg font-bold text-cyan-300 mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            Total Storage Usage
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-cyan-400">
                {formatBytes(totalSizeBytes)}
              </p>
              <p className="text-sm text-cyan-300/70 mt-1">
                Websites are storing this much data about you
              </p>
            </div>
            {pieData.length > 0 && (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={25}
                      outerRadius={50}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: number) => formatBytes(value)}
                      contentStyle={{ 
                        background: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {pieData.map((item, index) => (
              <div key={index} className="flex items-center gap-1 text-xs">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tracking Persistence Timeline */}
        <div className="p-6 rounded-xl border border-slate-500/30 bg-slate-900/30">
          <h4 className="text-lg font-bold text-slate-300 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Tracking Persistence Timeline
          </h4>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-24 text-xs text-muted-foreground">Session</div>
              <div className="flex-1 h-4 bg-green-500/30 rounded-full relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[10%] bg-green-500 rounded-full" />
              </div>
              <div className="w-32 text-xs">Cleared on tab close</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-24 text-xs text-muted-foreground">Session Cookies</div>
              <div className="flex-1 h-4 bg-yellow-500/30 rounded-full relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[25%] bg-yellow-500 rounded-full" />
              </div>
              <div className="w-32 text-xs">Browser close</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-24 text-xs text-muted-foreground">Persistent Cookies</div>
              <div className="flex-1 h-4 bg-orange-500/30 rounded-full relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[70%] bg-orange-500 rounded-full" />
              </div>
              <div className="w-32 text-xs">1 year or more</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-24 text-xs text-muted-foreground">LocalStorage</div>
              <div className="flex-1 h-4 bg-red-500/30 rounded-full relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-full bg-red-500 rounded-full" />
              </div>
              <div className="w-32 text-xs">Indefinitely</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-24 text-xs text-muted-foreground">IndexedDB</div>
              <div className="flex-1 h-4 bg-red-500/30 rounded-full relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-full bg-red-500 rounded-full" />
              </div>
              <div className="w-32 text-xs">Indefinitely</div>
            </div>
          </div>
        </div>

        {/* What This Means */}
        <div className="p-6 rounded-xl border border-blue-500/30 bg-blue-950/30">
          <h4 className="text-lg font-bold text-blue-300 mb-4 flex items-center gap-2">
            <Info className="w-5 h-5" />
            Storage & Tracking Persistence
          </h4>
          <p className="text-sm text-blue-200/80 leading-relaxed">
            Websites store data on your device to track you over time. Even after clearing your 
            browsing history, this stored data can identify you on return visits. Combined with 
            your browser fingerprint, this creates a persistent identity that follows you across 
            the web.
          </p>
        </div>

        {/* Storage Types Explained */}
        <div className="space-y-2">
          <h4 className="text-lg font-bold text-slate-300 mb-4">Storage Types Explained</h4>
          
          {[
            {
              id: 'cookies',
              icon: <Cookie className="w-4 h-4" />,
              title: 'Cookies',
              description: 'Small text files that track your sessions and preferences. Third-party cookies from ad networks are the most privacy-invasive.',
            },
            {
              id: 'localstorage',
              icon: <HardDrive className="w-4 h-4" />,
              title: 'LocalStorage',
              description: 'Key-value storage that persists forever. Often used by analytics tools to track you across visits.',
            },
            {
              id: 'sessionstorage',
              icon: <Clock className="w-4 h-4" />,
              title: 'SessionStorage',
              description: 'Temporary storage cleared when you close the tab. Least privacy-invasive.',
            },
            {
              id: 'indexeddb',
              icon: <Database className="w-4 h-4" />,
              title: 'IndexedDB',
              description: 'Database storage for complex web apps. Can store large amounts of data including your usage patterns.',
            },
            {
              id: 'cache',
              icon: <Box className="w-4 h-4" />,
              title: 'Cache Storage',
              description: 'Stores website assets for offline use. Service workers can track your behavior even without cookies.',
            },
          ].map((item) => (
            <Collapsible key={item.id} open={expandedSections[item.id]} onOpenChange={() => toggleSection(item.id)}>
              <CollapsibleTrigger className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-slate-800/50 transition-colors">
                <span className="text-cyan-400">{item.icon}</span>
                <span className="font-medium flex-1 text-left">{item.title}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections[item.id] ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-10 pb-3">
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>

        {/* Privacy Impact */}
        <div className="p-4 rounded-xl border border-slate-500/30 bg-slate-900/30">
          <h4 className="font-bold text-slate-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Privacy Impact Assessment
          </h4>
          <div className={`p-4 rounded-lg ${getRiskColor(storageData.overallRisk)}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{getRiskIcon(storageData.overallRisk)}</span>
              <div>
                <p className="font-semibold capitalize">{storageData.overallRisk} Risk</p>
                <p className="text-sm opacity-80">
                  {storageData.overallRisk === 'high' && 'Third-party cookies and tracking detected'}
                  {storageData.overallRisk === 'medium' && 'Some tracking detected in storage'}
                  {storageData.overallRisk === 'low' && 'Minimal storage, mostly session data'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Detected Tracking Keys */}
        {allTrackingKeys.length > 0 && (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-950/30">
            <h4 className="font-bold text-red-300 mb-3 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Tracking & Analytics Detected
            </h4>
            <div className="space-y-2">
              {allTrackingKeys.slice(0, 10).map((key, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  <span className="text-red-400">•</span>
                  <span className="font-mono text-red-300">{key}</span>
                  <span className="text-muted-foreground">({getTrackingKeyDescription(key)})</span>
                </div>
              ))}
              {allTrackingKeys.length > 10 && (
                <p className="text-xs text-muted-foreground">
                  ...and {allTrackingKeys.length - 10} more tracking keys
                </p>
              )}
            </div>
            <p className="mt-3 text-xs text-red-300/70">
              These keys indicate active tracking by third parties
            </p>
          </div>
        )}

        {/* Storage Clearing Guide */}
        <Collapsible open={expandedSections['clearing']} onOpenChange={() => toggleSection('clearing')}>
          <CollapsibleTrigger className="flex items-center gap-3 w-full p-4 rounded-xl border border-slate-500/30 bg-slate-900/30 hover:bg-slate-800/50 transition-colors">
            <Trash2 className="w-5 h-5 text-slate-400" />
            <span className="font-bold text-slate-300 flex-1 text-left">Storage Clearing Guide</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections['clearing'] ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 p-4 rounded-xl border border-slate-500/30 bg-slate-900/30">
            <div className="space-y-4">
              <div>
                <h5 className="font-semibold text-slate-300 mb-2">Chrome:</h5>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Settings → Privacy → Clear browsing data</li>
                  <li>Select: Cookies, Cached images, Site settings</li>
                </ul>
              </div>
              <div>
                <h5 className="font-semibold text-slate-300 mb-2">Firefox:</h5>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Options → Privacy → Clear Data</li>
                  <li>Select: Cookies, Cache</li>
                </ul>
              </div>
              <div>
                <h5 className="font-semibold text-slate-300 mb-2">Safari:</h5>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Preferences → Privacy → Manage Website Data</li>
                </ul>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-cyan-400 border-cyan-500/30"
                onClick={() => window.open('chrome://settings/clearBrowserData', '_blank')}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open Browser Settings
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Protection Recommendations */}
        <div className="p-4 rounded-xl border border-green-500/30 bg-green-950/30">
          <h4 className="font-bold text-green-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Protection Recommendations
          </h4>
          <ul className="space-y-2 text-sm text-green-200/80">
            <li className="flex items-start gap-2">
              <span className="text-green-400">✓</span>
              Clear storage regularly
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">✓</span>
              Use private/incognito mode
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">✓</span>
              Block third-party cookies
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">✓</span>
              Use privacy extensions (Cookie AutoDelete)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">✓</span>
              Enable "Clear on exit" in browser settings
            </li>
          </ul>
        </div>

        {/* Clear Storage Button */}
        <div className="flex flex-wrap gap-4 items-center justify-between p-4 rounded-xl border border-red-500/30 bg-red-950/20">
          <div>
            <h4 className="font-bold text-red-300">Clear This Site's Storage</h4>
            <p className="text-xs text-muted-foreground">This will log you out and reset settings</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="destructive" 
                disabled={isClearing}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {isClearing ? 'Clearing...' : 'Clear Storage'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  Clear All Storage?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will clear all cookies, localStorage, sessionStorage, and cached data 
                  for this site. You will be logged out and all settings will be reset.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearStorage} className="bg-red-600 hover:bg-red-700">
                  Yes, Clear Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Storage Monitoring */}
        <div className="flex items-center justify-between p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/20">
          <div className="flex items-center gap-3">
            <Eye className="w-5 h-5 text-cyan-400" />
            <div>
              <h4 className="font-semibold text-cyan-300">Monitor Storage Changes</h4>
              <p className="text-xs text-muted-foreground">
                {monitoringEnabled 
                  ? `${storageChanges} changes detected since enabled`
                  : 'Track new storage additions over time'
                }
              </p>
            </div>
          </div>
          <Switch
            checked={monitoringEnabled}
            onCheckedChange={toggleMonitoring}
          />
        </div>
      </CardContent>
    </Card>
  );
}
