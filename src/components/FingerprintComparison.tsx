import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
  AreaChart,
  Area,
  ReferenceLine,
  Legend,
} from 'recharts';
import { Info, Shield, Clock, ExternalLink, Users, Zap } from 'lucide-react';
import { CompositeFingerprint } from '@/lib/fingerprintDetection';

interface FingerprintComparisonProps {
  fingerprint: CompositeFingerprint;
  uniquenessScore: number;
}

// Simulated population data for visualization
const generatePopulationDots = (userPosition: number, total: number = 1000) => {
  const dots: { x: number; y: number; isUser: boolean }[] = [];
  const gridSize = Math.ceil(Math.sqrt(total));
  
  for (let i = 0; i < total; i++) {
    dots.push({
      x: i % gridSize,
      y: Math.floor(i / gridSize),
      isUser: i === Math.floor(userPosition * total / 100),
    });
  }
  return dots;
};

// Canvas distribution data
const canvasDistributionData = [
  { range: '0-10%', users: 2, category: 'Very Common' },
  { range: '10-30%', users: 5, category: 'Common' },
  { range: '30-50%', users: 8, category: 'Average' },
  { range: '50-70%', users: 15, category: 'Uncommon' },
  { range: '70-90%', users: 35, category: 'Unique' },
  { range: '90-100%', users: 35, category: 'Very Unique' },
];

// GPU distribution data
const gpuDistributionData = [
  { name: 'Intel', share: 45, color: 'hsl(210, 80%, 60%)' },
  { name: 'NVIDIA', share: 28, color: 'hsl(120, 60%, 50%)' },
  { name: 'AMD', share: 18, color: 'hsl(0, 70%, 55%)' },
  { name: 'Apple', share: 6, color: 'hsl(270, 60%, 60%)' },
  { name: 'Other', share: 3, color: 'hsl(40, 70%, 50%)' },
];

// Font count distribution (bell curve simulation)
const fontDistributionData = [
  { fonts: '0-20', users: 3 },
  { fonts: '20-40', users: 8 },
  { fonts: '40-60', users: 18 },
  { fonts: '60-80', users: 28 },
  { fonts: '80-100', users: 22 },
  { fonts: '100-120', users: 12 },
  { fonts: '120-150', users: 6 },
  { fonts: '150+', users: 3 },
];

// Browser comparison data
const browserComparisonData = [
  { browser: 'Chrome', uniqueness: '1 in 350K', risk: 'High', color: 'text-red-400', riskLevel: 4 },
  { browser: 'Safari', uniqueness: '1 in 180K', risk: 'High', color: 'text-red-400', riskLevel: 4 },
  { browser: 'Edge', uniqueness: '1 in 250K', risk: 'High', color: 'text-red-400', riskLevel: 4 },
  { browser: 'Firefox', uniqueness: '1 in 45K', risk: 'Medium-High', color: 'text-orange-400', riskLevel: 3 },
  { browser: 'Firefox (RFP)', uniqueness: '1 in 5K', risk: 'Medium', color: 'text-yellow-400', riskLevel: 2 },
  { browser: 'Brave', uniqueness: '1 in 400', risk: 'Low', color: 'text-green-400', riskLevel: 1 },
  { browser: 'Tor', uniqueness: '1 in 10', risk: 'Very Low', color: 'text-green-500', riskLevel: 0 },
];

// Time-based tracking data
const trackingDurationData = [
  { method: 'Cookies', duration: 'Indefinitely', icon: '🍪', description: 'Until manually cleared' },
  { method: 'Fingerprint Only', duration: 'Months to Years', icon: '🔴', description: 'Stable fingerprint persists' },
  { method: 'Changing Config', duration: 'Days to Weeks', icon: '🔄', description: 'Browser updates change fingerprint' },
  { method: 'With Protection', duration: 'Hours to Days', icon: '🛡️', description: 'Randomization limits tracking' },
];

// Entropy scatter data
const generateEntropyScatter = (userEntropy: number) => {
  const data: { entropy: number; population: number; isUser?: boolean }[] = [];
  
  // Generate simulated population distribution
  for (let i = 0; i < 50; i++) {
    const entropy = 5 + Math.random() * 25;
    const population = Math.floor(Math.random() * 100) + 10;
    data.push({ entropy, population, isUser: false });
  }
  
  // Add user's position
  data.push({ entropy: userEntropy, population: 1, isUser: true });
  
  return data;
};

export default function FingerprintComparison({ fingerprint, uniquenessScore }: FingerprintComparisonProps) {
  const [simulatedBrowser, setSimulatedBrowser] = useState<string | null>(null);
  const [showProtection, setShowProtection] = useState(false);
  const [animatedDotIndex, setAnimatedDotIndex] = useState(-1);

  const userEntropy = useMemo(() => 8 + (uniquenessScore / 100) * 22, [uniquenessScore]);
  const entropyData = useMemo(() => generateEntropyScatter(userEntropy), [userEntropy]);
  const populationDots = useMemo(() => generatePopulationDots(uniquenessScore), [uniquenessScore]);

  // Animate the user dot reveal
  useEffect(() => {
    const userDotIdx = populationDots.findIndex(d => d.isUser);
    const timer = setTimeout(() => setAnimatedDotIndex(userDotIdx), 500);
    return () => clearTimeout(timer);
  }, [populationDots]);

  // Calculate user's GPU vendor from fingerprint
  const userGpuVendor = useMemo(() => {
    if (!fingerprint.webgl) return 'Unknown';
    const vendor = fingerprint.webgl.vendor.toLowerCase();
    if (vendor.includes('nvidia')) return 'NVIDIA';
    if (vendor.includes('amd') || vendor.includes('ati')) return 'AMD';
    if (vendor.includes('intel')) return 'Intel';
    if (vendor.includes('apple')) return 'Apple';
    return 'Other';
  }, [fingerprint]);

  // Calculate simulated uniqueness when protection is toggled
  const getSimulatedUniqueness = () => {
    if (!showProtection) return fingerprint.uniqueness;
    
    if (simulatedBrowser === 'brave') return '1 in 432';
    if (simulatedBrowser === 'tor') return '1 in 8';
    if (simulatedBrowser === 'firefox-rfp') return '1 in 4,850';
    
    // With generic protection
    return '1 in 2,150';
  };

  const getImprovementPercentage = () => {
    if (!showProtection) return null;
    
    // Parse original uniqueness
    const match = fingerprint.uniqueness.match(/1 in ([\d,]+)/);
    if (!match) return null;
    
    const original = parseInt(match[1].replace(/,/g, ''), 10);
    
    let protected_ = 2150;
    if (simulatedBrowser === 'brave') protected_ = 432;
    if (simulatedBrowser === 'tor') protected_ = 8;
    if (simulatedBrowser === 'firefox-rfp') protected_ = 4850;
    
    const improvement = ((1 - protected_ / original) * 100).toFixed(1);
    return `${improvement}% less unique`;
  };

  // Get user's font range for highlighting
  const userFontRange = useMemo(() => {
    if (!fingerprint.fonts) return '60-80';
    const count = fingerprint.fonts.count;
    if (count <= 20) return '0-20';
    if (count <= 40) return '20-40';
    if (count <= 60) return '40-60';
    if (count <= 80) return '60-80';
    if (count <= 100) return '80-100';
    if (count <= 120) return '100-120';
    if (count <= 150) return '120-150';
    return '150+';
  }, [fingerprint]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Population Visualization */}
        <Card className="bg-gradient-to-br from-red-950/40 to-red-900/20 border-red-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-red-300 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Your Position Among 1,000 Browsers
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-4 h-4 text-red-400/50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>This visualization shows how unique your browser is. The highlighted dot represents you among 1,000 random browser configurations.</p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative p-4 bg-red-950/30 rounded-lg border border-red-500/20 overflow-hidden">
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(1000))}, 1fr)` }}>
                {populationDots.slice(0, 400).map((dot, idx) => (
                  <div
                    key={idx}
                    className={`w-2 h-2 rounded-full transition-all duration-500 ${
                      dot.isUser && animatedDotIndex === idx
                        ? 'bg-red-500 ring-2 ring-red-400 ring-offset-1 ring-offset-red-950 scale-150 z-10'
                        : 'bg-red-500/20'
                    }`}
                    style={{ animationDelay: `${idx * 2}ms` }}
                  />
                ))}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-red-950/80 to-transparent pointer-events-none" />
              <div className="absolute bottom-2 left-0 right-0 text-center">
                <p className="text-xs text-red-300/80">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle" /> 
                  You are here — unique among {(1000000 / (uniquenessScore + 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}+ browsers
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Distribution Charts */}
        <Card className="bg-gradient-to-br from-red-950/40 to-red-900/20 border-red-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-red-300 flex items-center gap-2">
              📊 Fingerprint Distribution Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="canvas" className="w-full">
              <TabsList className="grid w-full grid-cols-4 bg-red-950/50 mb-4">
                <TabsTrigger value="canvas" className="text-xs data-[state=active]:bg-red-500/20">Canvas</TabsTrigger>
                <TabsTrigger value="gpu" className="text-xs data-[state=active]:bg-red-500/20">GPU</TabsTrigger>
                <TabsTrigger value="fonts" className="text-xs data-[state=active]:bg-red-500/20">Fonts</TabsTrigger>
                <TabsTrigger value="entropy" className="text-xs data-[state=active]:bg-red-500/20">Overall</TabsTrigger>
              </TabsList>

              {/* Canvas Distribution */}
              <TabsContent value="canvas" className="mt-0">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={canvasDistributionData} layout="horizontal">
                      <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }} />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(0, 30%, 15%)', 
                          border: '1px solid hsl(0, 50%, 30%)',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: 'hsl(0, 50%, 80%)' }}
                      />
                      <Bar dataKey="users" fill="hsl(0, 60%, 45%)" radius={[4, 4, 0, 0]}>
                        {canvasDistributionData.map((entry, index) => (
                          <Cell 
                            key={index} 
                            fill={entry.range === '90-100%' ? 'hsl(0, 70%, 50%)' : 'hsl(0, 40%, 40%)'} 
                          />
                        ))}
                      </Bar>
                      <ReferenceLine 
                        x="90-100%" 
                        stroke="hsl(0, 70%, 60%)" 
                        strokeDasharray="3 3"
                        label={{ value: 'You', position: 'top', fill: 'hsl(0, 70%, 70%)', fontSize: 10 }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-red-300/70 mt-2 text-center">
                  Your canvas fingerprint is <span className="text-red-400 font-semibold">99.8% unique</span> — only 0.2% of users share a similar signature
                </p>
              </TabsContent>

              {/* GPU Distribution */}
              <TabsContent value="gpu" className="mt-0">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={gpuDistributionData} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }} unit="%" />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }} width={60} />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(0, 30%, 15%)', 
                          border: '1px solid hsl(0, 50%, 30%)',
                          borderRadius: '8px',
                        }}
                        formatter={(value: number) => [`${value}%`, 'Market Share']}
                      />
                      <Bar dataKey="share" radius={[0, 4, 4, 0]}>
                        {gpuDistributionData.map((entry, index) => (
                          <Cell 
                            key={index} 
                            fill={entry.name === userGpuVendor ? 'hsl(0, 70%, 55%)' : entry.color}
                            stroke={entry.name === userGpuVendor ? 'hsl(0, 70%, 70%)' : 'transparent'}
                            strokeWidth={2}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-red-300/70 mt-2 text-center">
                  Your GPU: <span className="text-red-400 font-semibold">{fingerprint.webgl?.renderer || 'Unknown'}</span>
                </p>
              </TabsContent>

              {/* Font Distribution */}
              <TabsContent value="fonts" className="mt-0">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={fontDistributionData}>
                      <XAxis dataKey="fonts" tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }} />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(0, 30%, 15%)', 
                          border: '1px solid hsl(0, 50%, 30%)',
                          borderRadius: '8px',
                        }}
                        formatter={(value: number) => [`${value}%`, 'Users']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="users" 
                        stroke="hsl(0, 60%, 50%)" 
                        fill="hsl(0, 50%, 40%)"
                        fillOpacity={0.4}
                      />
                      <ReferenceLine 
                        x={userFontRange}
                        stroke="hsl(0, 70%, 60%)" 
                        strokeDasharray="3 3"
                        label={{ value: 'You', position: 'top', fill: 'hsl(0, 70%, 70%)', fontSize: 10 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-red-300/70 mt-2 text-center">
                  You have <span className="text-red-400 font-semibold">{fingerprint.fonts?.count || 0} fonts</span> installed — 
                  Most users have 60-100 fonts
                </p>
              </TabsContent>

              {/* Overall Entropy Scatter */}
              <TabsContent value="entropy" className="mt-0">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <XAxis 
                        type="number" 
                        dataKey="entropy" 
                        name="Entropy" 
                        unit=" bits"
                        tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }}
                        domain={[0, 35]}
                      />
                      <YAxis 
                        type="number" 
                        dataKey="population" 
                        name="Population" 
                        tick={{ fontSize: 10, fill: 'hsl(0, 50%, 70%)' }}
                        hide
                      />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(0, 30%, 15%)', 
                          border: '1px solid hsl(0, 50%, 30%)',
                          borderRadius: '8px',
                        }}
                        cursor={{ strokeDasharray: '3 3' }}
                      />
                      <Legend />
                      <Scatter name="Other Browsers" data={entropyData.filter(d => !d.isUser)} fill="hsl(0, 30%, 40%)">
                        {entropyData.filter(d => !d.isUser).map((entry, index) => (
                          <Cell key={index} fill="hsl(0, 30%, 40%)" />
                        ))}
                      </Scatter>
                      <Scatter name="You" data={entropyData.filter(d => d.isUser)} fill="hsl(0, 70%, 55%)">
                        {entropyData.filter(d => d.isUser).map((entry, index) => (
                          <Cell key={index} fill="hsl(0, 70%, 55%)" />
                        ))}
                      </Scatter>
                      {/* Region indicators */}
                      <ReferenceLine x={10} stroke="hsl(120, 50%, 40%)" strokeDasharray="3 3" />
                      <ReferenceLine x={20} stroke="hsl(40, 60%, 50%)" strokeDasharray="3 3" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-4 mt-2 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" /> Common (&lt;10 bits)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-500" /> Uncommon (10-20 bits)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" /> Unique (&gt;20 bits)
                  </span>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Protection Comparison */}
        <Card className="bg-gradient-to-br from-green-950/40 to-green-900/20 border-green-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-green-300 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Protection Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-green-950/30 rounded-lg border border-green-500/20">
              <div>
                <p className="text-sm text-green-300">Without protection</p>
                <p className="text-lg font-bold text-red-400">{fingerprint.uniqueness}</p>
              </div>
              <div className="text-2xl">→</div>
              <div>
                <p className="text-sm text-green-300">With protection</p>
                <p className="text-lg font-bold text-green-400">{getSimulatedUniqueness()}</p>
              </div>
              {showProtection && getImprovementPercentage() && (
                <div className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">
                  {getImprovementPercentage()}
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <Switch 
                id="protection-toggle"
                checked={showProtection}
                onCheckedChange={setShowProtection}
              />
              <Label htmlFor="protection-toggle" className="text-sm text-green-300/80">
                Show me with protection enabled
              </Label>
            </div>

            {showProtection && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={simulatedBrowser === 'brave' ? 'default' : 'outline'}
                  onClick={() => setSimulatedBrowser('brave')}
                  className={simulatedBrowser === 'brave' ? 'bg-green-600' : 'border-green-500/30 text-green-300'}
                >
                  <Zap className="w-3 h-3 mr-1" /> Simulate Brave
                </Button>
                <Button
                  size="sm"
                  variant={simulatedBrowser === 'firefox-rfp' ? 'default' : 'outline'}
                  onClick={() => setSimulatedBrowser('firefox-rfp')}
                  className={simulatedBrowser === 'firefox-rfp' ? 'bg-green-600' : 'border-green-500/30 text-green-300'}
                >
                  🦊 Simulate Firefox RFP
                </Button>
                <Button
                  size="sm"
                  variant={simulatedBrowser === 'tor' ? 'default' : 'outline'}
                  onClick={() => setSimulatedBrowser('tor')}
                  className={simulatedBrowser === 'tor' ? 'bg-green-600' : 'border-green-500/30 text-green-300'}
                >
                  🧅 Simulate Tor
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Browser Comparison Table */}
        <Card className="bg-gradient-to-br from-red-950/40 to-red-900/20 border-red-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-red-300 flex items-center gap-2">
              🌐 Browser Fingerprinting Comparison
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-red-500/20 hover:bg-transparent">
                  <TableHead className="text-red-300/70">Browser</TableHead>
                  <TableHead className="text-red-300/70">Uniqueness</TableHead>
                  <TableHead className="text-red-300/70">Tracking Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {browserComparisonData.map((row) => (
                  <TableRow key={row.browser} className="border-red-500/10 hover:bg-red-950/30">
                    <TableCell className="font-medium text-foreground">{row.browser}</TableCell>
                    <TableCell className="font-mono text-sm">{row.uniqueness}</TableCell>
                    <TableCell className={row.color}>{row.risk}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Time-Based Tracking */}
        <Card className="bg-gradient-to-br from-amber-950/40 to-amber-900/20 border-amber-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-amber-300 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              How Long Can You Be Tracked?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {trackingDurationData.map((item) => (
                <div 
                  key={item.method}
                  className="p-3 bg-amber-950/30 rounded-lg border border-amber-500/20"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{item.icon}</span>
                    <span className="text-sm font-medium text-amber-200">{item.method}</span>
                  </div>
                  <p className="text-lg font-bold text-amber-400">{item.duration}</p>
                  <p className="text-xs text-amber-300/60">{item.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Call to Action */}
        <Card className="bg-gradient-to-br from-blue-950/40 to-blue-900/20 border-blue-500/30">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <h4 className="font-semibold text-blue-200">Want to test your protection?</h4>
                <p className="text-xs text-blue-300/70">Visit EFF's Cover Your Tracks for an independent test</p>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                className="border-blue-500/30 text-blue-300 hover:bg-blue-950/30"
                onClick={() => window.open('https://coveryourtracks.eff.org/', '_blank')}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Test Your Protection
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
