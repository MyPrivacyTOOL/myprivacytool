/**
 * Device Orientation & Motion Demo Page (MPC-DEMO)
 * 
 * Live test page for phone motion sensors, orientation tracking, and hexagon integration.
 * - iOS 13+: Shows permission request + tracking
 * - Android: Auto-attaches sensors, no permission needed
 * - Desktop: Falls back to window resize events
 * 
 * Test URLs:
 * - Local: http://localhost:5173/device-demo
 * - Staging: https://staging.myprivacytool.io/device-demo
 * - Production: https://myprivacytool.io/device-demo (noindex)
 * 
 * @todo Add orientation compass visualization
 * @todo Add tilt/beta/gamma angle indicators
 * @todo Add motion sensor status (active/inactive)
 * @todo Verify 30-50ms latency with threshold filtering
 */

import { useEffect, useState } from "react";
import { Compass, Smartphone, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";

interface DeviceMotionData {
  alpha: number;
  beta: number;
  gamma: number;
  absoluteOrientationMatrix?: number[][];
}

interface OrientationData {
  type: "portrait-primary" | "portrait-secondary" | "landscape-primary" | "landscape-secondary";
  angle: number;
  permission?: "granted" | "denied" | "prompt";
}

const DeviceDemo = () => {
  const [motionData, setMotionData] = useState<DeviceMotionData>({
    alpha: 0,
    beta: 0,
    gamma: 0,
  });
  const [orientation, setOrientation] = useState<OrientationData>({
    type: "portrait-primary",
    angle: 0,
  });
  const [permissionStatus, setPermissionStatus] = useState<string>("unknown");
  const [supportedFeatures, setSupportedFeatures] = useState<{
    deviceMotion: boolean;
    orientation: boolean;
    permission: boolean;
  }>({
    deviceMotion: false,
    orientation: false,
    permission: false,
  });
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [updateLatency, setUpdateLatency] = useState<number>(0);
  const [thresholdFiltered, setThresholdFiltered] = useState<boolean>(false);

  const addLog = (msg: string) => {
    setEventLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 19)]);
  };

  // Detect supported features
  useEffect(() => {
    const features = {
      deviceMotion: typeof DeviceMotionEvent !== "undefined",
      orientation: typeof DeviceOrientationEvent !== "undefined",
      permission: typeof DeviceMotionEvent !== "undefined" && "requestPermission" in DeviceMotionEvent,
    };
    setSupportedFeatures(features);
    addLog(`Features detected: Motion=${features.deviceMotion}, Orientation=${features.orientation}, Permission=${features.permission}`);
  }, []);

  // Request iOS 13+ permission
  const requestMotionPermission = async () => {
    if ("requestPermission" in DeviceMotionEvent) {
      try {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        setPermissionStatus(permission);
        addLog(`Permission request: ${permission}`);

        if (permission === "granted") {
          attachMotionListener();
        }
      } catch (err) {
        addLog(`Permission error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // Attach motion listener
  const attachMotionListener = () => {
    const threshold = 3; // degrees
    let lastAlpha = 0,
      lastBeta = 0,
      lastGamma = 0;
    let lastUpdate = Date.now();

    const handleDeviceMotion = (event: DeviceMotionEvent) => {
      const now = Date.now();
      const latency = now - lastUpdate;
      setUpdateLatency(latency);
      lastUpdate = now;

      const alpha = Math.round((event.rotationRate?.alpha || 0) * 100) / 100;
      const beta = Math.round((event.rotationRate?.beta || 0) * 100) / 100;
      const gamma = Math.round((event.rotationRate?.gamma || 0) * 100) / 100;

      // Apply 3° threshold filter
      const needsUpdate =
        Math.abs(alpha - lastAlpha) > threshold ||
        Math.abs(beta - lastBeta) > threshold ||
        Math.abs(gamma - lastGamma) > threshold;

      if (needsUpdate) {
        setMotionData({ alpha, beta, gamma });
        lastAlpha = alpha;
        lastBeta = beta;
        lastGamma = gamma;
        setThresholdFiltered(true);
      } else {
        setThresholdFiltered(false);
      }
    };

    window.addEventListener("devicemotion", handleDeviceMotion);
    addLog("Motion listener attached");

    return () => window.removeEventListener("devicemotion", handleDeviceMotion);
  };

  // Attach orientation listener
  useEffect(() => {
    const handleOrientationChange = () => {
      const screen = window.screen as any;
      const type =
        screen.orientation?.type ||
        ((window.innerWidth > window.innerHeight ? "landscape" : "portrait") + "-primary");
      const angle = screen.orientation?.angle || 0;

      setOrientation({ type, angle });
      addLog(`Orientation changed: ${type} (${angle}°)`);
    };

    // Initial state
    handleOrientationChange();

    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("resize", handleOrientationChange);

    return () => {
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("resize", handleOrientationChange);
    };
  }, []);

  // Auto-attach for Android (no permission needed)
  useEffect(() => {
    if (!supportedFeatures.permission && supportedFeatures.deviceMotion) {
      attachMotionListener();
      addLog("Auto-attached motion (Android/Desktop)");
      setPermissionStatus("not-required");
    }
  }, [supportedFeatures]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Smartphone className="w-8 h-8 text-blue-400" />
            <h1 className="text-3xl md:text-4xl font-bold text-white">Device Orientation Demo</h1>
            <Compass className="w-8 h-8 text-blue-400" />
          </div>
          <p className="text-slate-400 text-lg">Test phone sensors, orientation tracking, and hexagon integration</p>
          <p className="text-xs text-slate-500">Live updates • Threshold filtered (3°) • Real-time latency measurement</p>
        </div>

        {/* Feature Support Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Device Motion */}
          <div className={`p-4 rounded-lg border ${supportedFeatures.deviceMotion ? "border-green-500 bg-green-950" : "border-red-500 bg-red-950"}`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white">Device Motion</h3>
                <p className="text-sm text-slate-300 mt-1">{supportedFeatures.deviceMotion ? "✓ Supported" : "✗ Not available"}</p>
              </div>
              {supportedFeatures.deviceMotion ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
            </div>
          </div>

          {/* Orientation API */}
          <div className={`p-4 rounded-lg border ${supportedFeatures.orientation ? "border-green-500 bg-green-950" : "border-red-500 bg-red-950"}`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white">Orientation API</h3>
                <p className="text-sm text-slate-300 mt-1">{supportedFeatures.orientation ? "✓ Supported" : "✗ Not available"}</p>
              </div>
              {supportedFeatures.orientation ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
            </div>
          </div>

          {/* Permission Model */}
          <div
            className={`p-4 rounded-lg border ${supportedFeatures.permission ? "border-blue-500 bg-blue-950" : "border-slate-600 bg-slate-800"}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white">Permission Model</h3>
                <p className="text-sm text-slate-300 mt-1">{supportedFeatures.permission ? "iOS 13+" : "Android / Desktop"}</p>
              </div>
              {supportedFeatures.permission && (
                <button
                  onClick={requestMotionPermission}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition"
                >
                  Request
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Compass Visualization */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-8 flex flex-col items-center space-y-6">
          <div className="w-32 h-32 relative bg-gradient-to-br from-slate-700 to-slate-900 rounded-full border-4 border-blue-500 flex items-center justify-center shadow-lg">
            <div
              className="w-1 h-12 bg-red-500 rounded-full origin-bottom transition-transform duration-100"
              style={{
                transform: `rotate(${motionData.alpha}deg)`,
              }}
            />
            <div className="absolute w-2 h-2 bg-white rounded-full" />
          </div>
          <div className="text-center">
            <p className="text-slate-400 text-sm">Heading</p>
            <p className="text-2xl font-bold text-white">{Math.round(motionData.alpha)}°</p>
          </div>
        </div>

        {/* Motion Data Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Rotation Rate */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-400" />
              Rotation Rate (°/s)
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-slate-400 text-sm">Alpha (Z-axis)</p>
                <p className="text-2xl font-mono text-green-400">{motionData.alpha.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Beta (X-axis)</p>
                <p className="text-2xl font-mono text-blue-400">{motionData.beta.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Gamma (Y-axis)</p>
                <p className="text-2xl font-mono text-purple-400">{motionData.gamma.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Orientation & Performance */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Orientation & Performance</h3>
            <div className="space-y-3">
              <div>
                <p className="text-slate-400 text-sm">Current Orientation</p>
                <p className="text-lg font-mono text-yellow-400">{orientation.type}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Screen Angle</p>
                <p className="text-lg font-mono text-yellow-400">{orientation.angle}°</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Update Latency</p>
                <p className={`text-lg font-mono ${updateLatency > 50 ? "text-red-400" : "text-green-400"}`}>
                  {updateLatency}ms
                </p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Threshold Filter</p>
                <p className={`text-lg font-mono ${thresholdFiltered ? "text-green-400" : "text-slate-500"}`}>
                  {thresholdFiltered ? "✓ Updated" : "— No change (3° filter)"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Permission Status */}
        <div className={`p-4 rounded-lg border ${permissionStatus === "granted" ? "border-green-500 bg-green-950" : permissionStatus === "not-required" ? "border-blue-500 bg-blue-950" : "border-slate-600 bg-slate-800"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">Permission Status</h3>
              <p className="text-sm text-slate-300 mt-1">
                {permissionStatus === "granted"
                  ? "✓ Motion sensors active"
                  : permissionStatus === "not-required"
                    ? "✓ Auto-attached (Android/Desktop)"
                    : permissionStatus === "denied"
                      ? "✗ Permission denied"
                      : "Click Request above to enable motion tracking"}
              </p>
            </div>
            {supportedFeatures.permission && permissionStatus !== "granted" && (
              <button
                onClick={requestMotionPermission}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition font-medium"
              >
                Enable Sensors
              </button>
            )}
          </div>
        </div>

        {/* Event Log */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-3">
          <h3 className="text-lg font-semibold text-white">Event Log (Last 20)</h3>
          <div className="bg-slate-900 rounded p-4 space-y-1 font-mono text-xs max-h-48 overflow-y-auto">
            {eventLog.length > 0 ? (
              eventLog.map((log, i) => (
                <div key={i} className="text-slate-400 hover:text-slate-200 transition">
                  {log}
                </div>
              ))
            ) : (
              <div className="text-slate-600">Waiting for events...</div>
            )}
          </div>
        </div>

        {/* Testing Instructions */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white">Testing Checklist</h3>
          <ul className="space-y-2 text-slate-300">
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">1.</span>
              <span>
                <strong>iOS:</strong> Click "Enable Sensors" → grant permission → rotate phone
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">2.</span>
              <span>
                <strong>Android:</strong> Permission auto-granted → rotate phone, watch compass update
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">3.</span>
              <span>
                <strong>Desktop:</strong> Resize browser window → watch orientation update (fallback)
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">4.</span>
              <span>
                <strong>Verify:</strong> Latency should be 30–50ms; threshold filter reduces noise
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">5.</span>
              <span>Check event log for permission flow, sensor attach, and update count</span>
            </li>
          </ul>
        </div>

        {/* Footer */}
        <div className="text-center text-slate-500 text-xs space-y-1 py-4 border-t border-slate-700">
          <p>Device Orientation & Motion Demo — MPC-DEMO</p>
          <p>Noindex • Staging only • Full end-to-end test for hexagon integration</p>
        </div>
      </div>
    </div>
  );
};

export default DeviceDemo;
