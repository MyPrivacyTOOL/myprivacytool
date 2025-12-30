import { useEffect, useRef } from 'react';

const MatrixRain = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(columns).fill(1);

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#00ff41';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Vary the brightness
        const brightness = Math.random();
        if (brightness > 0.98) {
          ctx.fillStyle = '#ffffff';
        } else if (brightness > 0.9) {
          ctx.fillStyle = '#7fff7f';
        } else {
          ctx.fillStyle = '#00ff41';
        }

        ctx.fillText(text, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const interval = setInterval(draw, 50);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return (
    <div className="relative w-full h-[400px] md:h-[500px] overflow-hidden bg-black">
      {/* Matrix Rain Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
      
      {/* Shadow Hands Overlay */}
      <div className="absolute inset-0 flex items-end justify-center pointer-events-none">
        {/* Left hand */}
        <div className="absolute left-[10%] bottom-0 w-32 h-64 md:w-48 md:h-80">
          <svg viewBox="0 0 100 200" className="w-full h-full opacity-80 animate-hand-push-left">
            <defs>
              <linearGradient id="handGradientLeft" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.9)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
              </linearGradient>
            </defs>
            <path
              d="M50 200 L50 120 L30 80 L30 60 M50 120 L40 70 L40 50 M50 120 L50 55 L50 40 M50 120 L60 70 L60 50 M50 120 L70 85 L70 65 L70 120 L80 130 L80 160 L50 200"
              fill="url(#handGradientLeft)"
              stroke="rgba(0,255,65,0.3)"
              strokeWidth="1"
            />
          </svg>
        </div>
        
        {/* Center hand - larger, more prominent */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-40 h-72 md:w-56 md:h-96">
          <svg viewBox="0 0 120 220" className="w-full h-full opacity-90 animate-hand-push-center">
            <defs>
              <linearGradient id="handGradientCenter" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.95)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.2)" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            <path
              d="M60 220 L60 140 L35 95 L35 55 M60 140 L45 85 L45 45 M60 140 L60 70 L60 35 M60 140 L75 85 L75 45 M60 140 L85 100 L85 70 L85 140 L100 155 L100 185 L60 220"
              fill="url(#handGradientCenter)"
              stroke="rgba(0,255,65,0.4)"
              strokeWidth="1.5"
              filter="url(#glow)"
            />
          </svg>
        </div>
        
        {/* Right hand */}
        <div className="absolute right-[10%] bottom-0 w-32 h-64 md:w-48 md:h-80">
          <svg viewBox="0 0 100 200" className="w-full h-full opacity-80 animate-hand-push-right transform scale-x-[-1]">
            <defs>
              <linearGradient id="handGradientRight" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.9)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
              </linearGradient>
            </defs>
            <path
              d="M50 200 L50 120 L30 80 L30 60 M50 120 L40 70 L40 50 M50 120 L50 55 L50 40 M50 120 L60 70 L60 50 M50 120 L70 85 L70 65 L70 120 L80 130 L80 160 L50 200"
              fill="url(#handGradientRight)"
              stroke="rgba(0,255,65,0.3)"
              strokeWidth="1"
            />
          </svg>
        </div>
      </div>
      
      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none" />
    </div>
  );
};

export default MatrixRain;
