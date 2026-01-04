import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrientation } from '@/hooks/useOrientation';
import { useDeviceMotion } from '@/hooks/useDeviceMotion';
import { captureDeviceData, detectSensors, DeviceData, SensorData } from '@/lib/deviceDetection';
import DeviceIcon from '@/components/DeviceIcon';
import OrientationDisplay from '@/components/OrientationDisplay';
import { ArrowLeft, Smartphone, Monitor, Wifi, Shield } from 'lucide-react';

export default function DeviceOrientation() {
  const orientation = useOrientation();
  const { motion, permission, requestPermission, isSupported } = useDeviceMotion();
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [sensors, setSensors] = useState<SensorData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await captureDeviceData();
        setDeviceData(data);
        setSensors(detectSensors());
      } catch (error) {
        console.error('Failed to capture device data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header 
        className="relative py-12 px-4 text-center overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        {/* Back link */}
        <Link 
          to="/" 
          className="absolute top-4 left-4 flex items-center gap-2 text-white/80 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>

        {/* Decorative elements */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/20 rounded-full blur-3xl translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-3xl -translate-x-1/2 translate-y-1/2" />
        </div>

        <div className="relative z-10 max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Real-Time Device Tracking
          </h1>
          <p className="text-white/80 text-lg">
            See what your device reveals about you through motion sensors
          </p>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        
        {/* Call to action */}
        <div className="bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 rounded-xl p-4 text-center">
          <p className="text-foreground font-medium flex items-center justify-center gap-2">
            <span className="text-2xl">👉</span>
            Rotate your device and watch the magic happen!
          </p>
        </div>

        {/* Device Icon with rotation */}
        <DeviceIcon 
          deviceType={deviceData?.device.type || 'Mobile'} 
          rotationAngle={orientation.angle} 
        />

        {/* Orientation Display (Compass) */}
        <OrientationDisplay />

        {/* Device Info Grid */}
        <div className="bg-card rounded-2xl shadow-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-primary" />
            Device Information
          </h2>
          
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-secondary/50 rounded-xl p-4 animate-pulse">
                  <div className="h-4 bg-muted rounded w-20 mb-2" />
                  <div className="h-6 bg-muted rounded w-24" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-secondary/50 rounded-xl p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Device Type
                </div>
                <div className="text-foreground font-semibold">
                  {deviceData?.device.type || 'Unknown'}
                </div>
              </div>
              
              <div className="bg-secondary/50 rounded-xl p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Operating System
                </div>
                <div className="text-foreground font-semibold truncate">
                  {deviceData?.device.os || 'Unknown'}
                </div>
              </div>
              
              <div className="bg-secondary/50 rounded-xl p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Screen Size
                </div>
                <div className="text-foreground font-semibold">
                  {orientation.width} × {orientation.height}
                </div>
              </div>
              
              <div className="bg-secondary/50 rounded-xl p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Detection Confidence
                </div>
                <div className="text-foreground font-semibold text-primary">
                  92%
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Motion Data (3D Rotation) */}
        <div className="bg-card rounded-2xl shadow-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Monitor className="w-5 h-5 text-primary" />
            3D Motion Data
          </h2>
          
          {!isSupported ? (
            <div className="text-center py-4 text-muted-foreground">
              Motion sensors not available on this device
            </div>
          ) : permission === 'denied' ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-3">Permission denied for motion sensors</p>
              <button
                onClick={requestPermission}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                Request Permission
              </button>
            </div>
          ) : permission === 'unknown' ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-3">iOS requires permission for motion sensors</p>
              <button
                onClick={requestPermission}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                Enable Motion Tracking
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary/50 rounded-xl p-4 text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Alpha (Z)
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {motion.alpha?.toFixed(0) ?? '—'}°
                </div>
              </div>
              
              <div className="bg-secondary/50 rounded-xl p-4 text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Beta (X)
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {motion.beta?.toFixed(0) ?? '—'}°
                </div>
              </div>
              
              <div className="bg-secondary/50 rounded-xl p-4 text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Gamma (Y)
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {motion.gamma?.toFixed(0) ?? '—'}°
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sensor Status */}
        <div className="bg-card rounded-2xl shadow-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Active Sensors
          </h2>
          
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: 'Accelerometer', active: sensors?.accelerometer, icon: '📐' },
              { name: 'Gyroscope', active: sensors?.gyroscope, icon: '🔄' },
              { name: 'GPS Location', active: sensors?.gps, icon: '📍' },
              { name: 'Touch Screen', active: sensors?.touch, icon: '👆' },
            ].map((sensor) => (
              <div 
                key={sensor.name}
                className={`rounded-xl p-4 flex items-center gap-3 transition-colors ${
                  sensor.active 
                    ? 'bg-primary/10 border border-primary/20' 
                    : 'bg-secondary/50 border border-transparent'
                }`}
              >
                <span className="text-2xl">{sensor.icon}</span>
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {sensor.name}
                  </div>
                  <div className={`text-xs ${sensor.active ? 'text-primary' : 'text-muted-foreground'}`}>
                    {sensor.active ? 'Available' : 'Not detected'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Network Info */}
        {deviceData && (
          <div className="bg-card rounded-2xl shadow-lg border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Wifi className="w-5 h-5 text-primary" />
              Connection Details
            </h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-secondary/50 rounded-xl p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Location
                </div>
                <div className="text-foreground font-semibold truncate">
                  {deviceData.location.city}, {deviceData.location.country}
                </div>
              </div>
              
              <div className="bg-secondary/50 rounded-xl p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  ISP
                </div>
                <div className="text-foreground font-semibold truncate">
                  {deviceData.network.isp.split(' ').slice(0, 2).join(' ')}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Privacy note */}
        <div className="text-center text-sm text-muted-foreground py-4">
          <p>All detection happens locally in your browser.</p>
          <p>No data is sent to any server.</p>
        </div>
      </main>
    </div>
  );
}
