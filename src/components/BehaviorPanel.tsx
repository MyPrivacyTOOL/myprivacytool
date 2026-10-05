import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Mouse, Keyboard, MousePointer2, ScrollText, Clock, Flame,
  ShieldAlert, Eye, EyeOff, Trash2, AlertTriangle, Activity,
  TrendingUp, BarChart3, Zap, Target, Info
} from 'lucide-react';
import {
  trackMouseMovement,
  trackTypingPatterns,
  trackClickBehavior,
  trackScrollBehavior,
  trackTimeOnSite,
  generateInteractionHeatmap,
  stopBehaviorTracking,
  clearBehaviorData,
  startBehaviorTracking,
  isTrackingActive
} from '@/lib/behaviorDetection';

interface BehaviorPanelProps {
  onClose?: () => void;
}

const BehaviorPanel: React.FC<BehaviorPanelProps> = ({ onClose }) => {
  const [mouseData, setMouseData] = useState(trackMouseMovement());
  const [typingData, setTypingData] = useState(trackTypingPatterns());
  const [clickData, setClickData] = useState(trackClickBehavior());
  const [scrollData, setScrollData] = useState(trackScrollBehavior());
  const [timeData, setTimeData] = useState(trackTimeOnSite());
  const [heatmapData, setHeatmapData] = useState(generateInteractionHeatmap());
  const [isTracking, setIsTracking] = useState(isTrackingActive());
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Update data every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (isTrackingActive()) {
        setMouseData(trackMouseMovement());
        setTypingData(trackTypingPatterns());
        setClickData(trackClickBehavior());
        setScrollData(trackScrollBehavior());
        setTimeData(trackTimeOnSite());
        setHeatmapData(generateInteractionHeatmap());
        setIsTracking(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Draw heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas cannot resolve CSS variables, so read theme tokens directly
    const rootStyle = getComputedStyle(document.documentElement);
    const tok = (name: string, alpha: number) =>
      `hsl(${rootStyle.getPropertyValue(name).trim()} / ${alpha})`;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background grid
    ctx.fillStyle = tok('--risk-mid', 0.06);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid lines
    ctx.strokeStyle = tok('--surface-border', 1);
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(i * (canvas.width / 10), 0);
      ctx.lineTo(i * (canvas.width / 10), canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * (canvas.height / 10));
      ctx.lineTo(canvas.width, i * (canvas.height / 10));
      ctx.stroke();
    }

    // Draw hotspots
    heatmapData.hotspots.forEach(spot => {
      const x = (spot.x / 100) * canvas.width;
      const y = (spot.y / 100) * canvas.height;
      const radius = 10 + spot.intensity * 20;

      // Create gradient
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      
      if (spot.intensity > 0.7) {
        gradient.addColorStop(0, tok('--risk-high', 0.8));
        gradient.addColorStop(0.5, tok('--risk-mid', 0.4));
        gradient.addColorStop(1, tok('--risk-mid', 0));
      } else if (spot.intensity > 0.4) {
        gradient.addColorStop(0, tok('--risk-mid', 0.6));
        gradient.addColorStop(0.5, tok('--risk-mid', 0.3));
        gradient.addColorStop(1, tok('--risk-mid', 0));
      } else {
        gradient.addColorStop(0, tok('--cat-language', 0.5));
        gradient.addColorStop(0.5, tok('--cat-language', 0.2));
        gradient.addColorStop(1, tok('--cat-language', 0));
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [heatmapData]);

  const handleStopTracking = useCallback(() => {
    stopBehaviorTracking();
    setIsTracking(false);
    setShowStopConfirm(true);
    setTimeout(() => setShowStopConfirm(false), 3000);
  }, []);

  const handleClearData = useCallback(() => {
    clearBehaviorData();
    startBehaviorTracking();
    setIsTracking(true);
    setMouseData(trackMouseMovement());
    setTypingData(trackTypingPatterns());
    setClickData(trackClickBehavior());
    setScrollData(trackScrollBehavior());
    setTimeData(trackTimeOnSite());
    setHeatmapData(generateInteractionHeatmap());
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getEngagementColor = (engagement: string) => {
    switch (engagement) {
      case 'high': return 'text-risk-low';
      case 'medium': return 'text-risk-mid';
      case 'low': return 'text-risk-high';
      default: return 'text-muted-foreground';
    }
  };

  const getPatternBadge = (pattern: string) => {
    if (pattern === 'human') {
      return <Badge className="bg-risk-low-soft text-risk-low border-risk-low/30">Human</Badge>;
    } else if (pattern === 'bot') {
      return <Badge className="bg-risk-high-soft text-risk-high border-risk-high/30">Bot</Badge>;
    }
    return <Badge className="bg-risk-mid-soft text-risk-mid border-risk-mid/30">Unknown</Badge>;
  };

  // Calculate session timeline
  const sessionProgress = Math.min((timeData.activeTime / timeData.totalTime) * 100, 100);

  return (
    <Card className="bg-gradient-to-br from-risk-mid-soft via-background to-risk-mid-soft border-risk-mid/30 shadow-card">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-risk-mid-soft animate-pulse">
              <Mouse className="w-6 h-6 text-risk-mid" />
            </div>
            <div>
              <CardTitle className="text-xl text-risk-mid">
                🖱️ Your Behavior is Being Tracked
              </CardTitle>
              <p className="text-sm text-risk-mid mt-1">
                Real-time interaction monitoring
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isTracking ? (
              <Badge className="bg-risk-high-soft text-risk-high border-risk-high/30 animate-pulse">
                <Activity className="w-3 h-3 mr-1" />
                LIVE
              </Badge>
            ) : (
              <Badge className="bg-muted text-muted-foreground border-surface-border">
                <EyeOff className="w-3 h-3 mr-1" />
                STOPPED
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Live Counter Banner */}
        <div className="p-4 rounded-lg bg-risk-mid-soft border border-risk-mid/30">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="w-4 h-4 text-risk-mid" />
            <span className="text-sm font-medium text-risk-mid">Live Tracking Summary</span>
          </div>
          <p className="text-sm text-risk-mid">
            We've tracked <span className="font-bold text-risk-mid">{mouseData.totalMovements}</span> mouse movements, 
            <span className="font-bold text-risk-mid"> {typingData.keystrokeCount}</span> keystrokes, and 
            <span className="font-bold text-risk-mid"> {clickData.totalClicks}</span> clicks in the last 
            <span className="font-bold text-risk-mid"> {formatTime(timeData.totalTime)}</span>.
          </p>
          <p className="text-xs text-risk-mid mt-2">
            This data is being used to profile your behavior patterns.
          </p>
        </div>

        {/* Tracking Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Mouse Movement Card */}
          <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Mouse className="w-4 h-4 text-risk-mid" />
                <span className="font-medium text-risk-mid">Mouse Movement</span>
              </div>
              {getPatternBadge(mouseData.pattern)}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total movements:</span>
                <span className="text-risk-mid font-mono">{mouseData.totalMovements}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Average speed:</span>
                <span className="text-risk-mid font-mono">{mouseData.averageSpeed.toFixed(1)} px/s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pattern detected:</span>
                <span className="text-risk-mid capitalize">{mouseData.pattern}</span>
              </div>
              <div className="mt-2">
                <Badge variant="outline" className="text-risk-high border-risk-high/30 text-xs">
                  High Risk
                </Badge>
              </div>
            </div>
          </div>

          {/* Typing Patterns Card */}
          <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-risk-mid" />
                <span className="font-medium text-risk-mid">Keystroke Dynamics</span>
              </div>
              {typingData.hasPattern ? (
                <Badge className="bg-risk-high-soft text-risk-high border-risk-high/30">Unique Signature</Badge>
              ) : (
                <Badge className="bg-muted text-muted-foreground border-surface-border">Collecting...</Badge>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Keystrokes:</span>
                <span className="text-risk-mid font-mono">{typingData.keystrokeCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Typing speed:</span>
                <span className="text-risk-mid font-mono">{typingData.averageSpeed.toFixed(0)} WPM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Signature detected:</span>
                <span className="text-risk-mid">{typingData.hasPattern ? 'Yes' : 'No'}</span>
              </div>
              <div className="mt-2">
                <Badge variant="outline" className="text-risk-mid border-risk-mid/30 text-xs">
                  Medium Risk
                </Badge>
              </div>
            </div>
          </div>

          {/* Click Behavior Card */}
          <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MousePointer2 className="w-4 h-4 text-risk-mid" />
                <span className="font-medium text-risk-mid">Click Patterns</span>
              </div>
              <Badge className="bg-risk-mid-soft text-risk-mid border-risk-mid/30">
                {clickData.pattern || 'Analyzing'}
              </Badge>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total clicks:</span>
                <span className="text-risk-mid font-mono">{clickData.totalClicks}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Click rate:</span>
                <span className="text-risk-mid font-mono">{clickData.clickRate.toFixed(2)}/min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Most clicked:</span>
                <span className="text-risk-mid truncate max-w-[120px]">
                  {clickData.targets.slice(0, 2).join(', ') || 'N/A'}
                </span>
              </div>
              <div className="mt-2">
                <Badge variant="outline" className="text-risk-mid border-risk-mid/30 text-xs">
                  Medium Risk
                </Badge>
              </div>
            </div>
          </div>

          {/* Scroll Activity Card */}
          <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-risk-mid" />
                <span className="font-medium text-risk-mid">Scroll Behavior</span>
              </div>
              <Badge className={`${getEngagementColor(scrollData.engagement)} bg-opacity-20 border-current/30`}>
                {scrollData.engagement.toUpperCase()}
              </Badge>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Scroll depth:</span>
                <span className="text-risk-mid font-mono">{scrollData.scrollDepth.toFixed(0)}%</span>
              </div>
              <Progress value={scrollData.scrollDepth} className="h-1 bg-risk-mid-soft" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total scrolls:</span>
                <span className="text-risk-mid font-mono">{scrollData.totalScrolls}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Engagement:</span>
                <span className={`${getEngagementColor(scrollData.engagement)} capitalize`}>
                  {scrollData.engagement}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Session Timeline */}
        <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-risk-mid" />
            <span className="font-medium text-risk-mid">Session Timeline</span>
            <Badge variant="outline" className="text-risk-low border-risk-low/30 text-xs ml-auto">
              Low Risk
            </Badge>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total time:</span>
              <span className="text-risk-mid font-mono">{formatTime(timeData.totalTime)}</span>
            </div>
            <div className="relative h-4 bg-muted rounded-full overflow-hidden">
              <div 
                className="absolute left-0 top-0 h-full bg-risk-low"
                style={{ width: `${sessionProgress}%` }}
              />
              <div 
                className="absolute top-0 h-full bg-muted"
                style={{ left: `${sessionProgress}%`, width: `${100 - sessionProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Active: {formatTime(timeData.activeTime)}</span>
              <span>Idle: {formatTime(timeData.idleTime)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tab switches:</span>
              <span className="text-risk-mid font-mono">{timeData.tabSwitches}</span>
            </div>
          </div>
        </div>

        {/* Interaction Heatmap */}
        <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4 text-risk-mid" />
            <span className="font-medium text-risk-mid">Interaction Heatmap</span>
            <Badge variant="outline" className="text-risk-high border-risk-high/30 text-xs ml-auto">
              High Risk
            </Badge>
          </div>
          <div className="relative rounded-lg overflow-hidden border border-risk-mid/30">
            <canvas 
              ref={canvasRef}
              width={400}
              height={200}
              className="w-full h-48"
            />
            <div className="absolute bottom-2 right-2 flex gap-2 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-risk-high" />
                <span className="text-muted-foreground">High</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-risk-mid" />
                <span className="text-muted-foreground">Medium</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-[hsl(var(--cat-language))]" />
                <span className="text-muted-foreground">Low</span>
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Hotspots detected:</span>
            <span className="text-risk-mid font-mono">{heatmapData.hotspots.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Engagement score:</span>
            <span className="text-risk-mid font-mono">{heatmapData.engagementScore.toFixed(0)}%</span>
          </div>
        </div>

        {/* What This Reveals */}
        <div className="p-4 rounded-lg bg-risk-high-soft border border-risk-high/30">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-5 h-5 text-risk-high" />
            <span className="font-medium text-risk-high">What This Reveals About You</span>
          </div>
          <p className="text-sm text-risk-high mb-3">
            Behavioral biometrics can uniquely identify you based on:
          </p>
          <ul className="space-y-2 text-sm text-risk-high">
            <li className="flex items-start gap-2">
              <Target className="w-4 h-4 text-risk-high mt-0.5 flex-shrink-0" />
              <span>Mouse movement patterns are <strong className="text-risk-high">97% unique</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <Zap className="w-4 h-4 text-risk-high mt-0.5 flex-shrink-0" />
              <span>Typing rhythm is like a <strong className="text-risk-high">fingerprint</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <BarChart3 className="w-4 h-4 text-risk-high mt-0.5 flex-shrink-0" />
              <span>Scroll behavior reveals <strong className="text-risk-high">reading patterns</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-risk-high mt-0.5 flex-shrink-0" />
              <span>Click patterns show <strong className="text-risk-high">decision-making style</strong></span>
            </li>
          </ul>
          <p className="text-xs text-risk-high mt-3 p-2 bg-risk-high-soft rounded">
            Combined, these create a behavioral signature that can track you across sites 
            even without cookies or fingerprints.
          </p>
        </div>

        {/* How Sites Use This */}
        <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-risk-mid" />
            <span className="font-medium text-risk-mid">How Sites Use This Data</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              'Bot detection (CAPTCHA alternatives)',
              'User authentication',
              'Fraud detection in banking',
              'Cross-site user tracking',
              'Engagement analytics',
              'A/B testing optimization'
            ].map((use, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded bg-risk-mid-soft">
                <div className="w-1.5 h-1.5 rounded-full bg-risk-mid" />
                <span className="text-muted-foreground text-xs">{use}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Privacy Impact */}
        <div className="p-4 rounded-lg bg-risk-mid-soft border border-risk-mid/30">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-risk-mid" />
            <span className="font-medium text-risk-mid">Privacy Impact</span>
          </div>
          <p className="text-sm text-risk-mid mb-3">
            Unlike fingerprints or cookies, behavioral tracking:
          </p>
          <ul className="space-y-1.5 text-sm text-risk-mid">
            <li>• Cannot be blocked by browser extensions</li>
            <li>• Works in incognito/private mode</li>
            <li>• Doesn't require storage or cookies</li>
            <li>• Is completely invisible to users</li>
            <li>• Combines with other data for super-tracking</li>
          </ul>
        </div>

        {/* Protection Recommendations */}
        <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-risk-mid" />
            <span className="font-medium text-risk-mid">Protection Recommendations</span>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-risk-mid">•</span>
              Use mouse movement randomizers (limited effectiveness)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-risk-mid">•</span>
              Vary your typing speed and patterns
            </li>
            <li className="flex items-start gap-2">
              <span className="text-risk-mid">•</span>
              Use autofill instead of typing sensitive data
            </li>
            <li className="flex items-start gap-2">
              <span className="text-risk-mid">•</span>
              Navigate via keyboard instead of mouse when possible
            </li>
            <li className="flex items-start gap-2">
              <span className="text-risk-mid">•</span>
              <strong className="text-risk-mid">Understand that complete protection is nearly impossible</strong>
            </li>
          </ul>
        </div>

        {/* Data Control Buttons */}
        <div className="p-4 rounded-lg bg-surface/95 border border-risk-mid/30">
          <div className="flex items-center gap-2 mb-4">
            <EyeOff className="w-4 h-4 text-risk-mid" />
            <span className="font-medium text-risk-mid">Data Control</span>
          </div>
          
          {showStopConfirm && (
            <div className="mb-4 p-3 rounded-lg bg-risk-low-soft border border-risk-low/30 text-sm text-risk-low">
              ✓ Tracking stopped for this session
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              onClick={handleStopTracking}
              disabled={!isTracking}
              variant="outline"
              className="flex-1 border-risk-high/30 text-risk-high hover:bg-risk-high-soft hover:text-risk-high"
            >
              <EyeOff className="w-4 h-4 mr-2" />
              Stop Tracking for This Session
            </Button>
            <Button 
              onClick={handleClearData}
              variant="outline"
              className="flex-1 border-risk-mid/30 text-risk-mid hover:bg-risk-mid-soft hover:text-risk-mid"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear & Restart Tracking
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground mt-3 text-center">
            ⚠️ This only stops our demo. Real sites continue tracking.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default BehaviorPanel;
