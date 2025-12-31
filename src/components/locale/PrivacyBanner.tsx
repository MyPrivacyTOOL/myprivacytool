import { Shield, Lock, Eye, Server } from 'lucide-react';

export default function PrivacyBanner() {
  return (
    <div className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/20 rounded-xl p-6">
      <div className="flex flex-col md:flex-row items-center gap-6">
        {/* Shield Icon */}
        <div className="flex-shrink-0">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Shield className="w-8 h-8 text-primary" />
          </div>
        </div>
        
        {/* Main Message */}
        <div className="flex-1 text-center md:text-left">
          <h3 className="text-lg font-bold text-foreground mb-2">
            100% Privacy-Preserving
          </h3>
          <p className="text-sm text-muted-foreground">
            All processing happens entirely in your browser. No data is sent to any server.
          </p>
        </div>
        
        {/* Features */}
        <div className="flex flex-wrap justify-center md:justify-end gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="w-4 h-4 text-primary" />
            <span>No API calls</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Eye className="w-4 h-4 text-primary" />
            <span>Client-side only</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Server className="w-4 h-4 text-primary" />
            <span>No data storage</span>
          </div>
        </div>
      </div>
    </div>
  );
}
