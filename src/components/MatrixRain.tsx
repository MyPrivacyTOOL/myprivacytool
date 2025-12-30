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
        {/* Left hand - realistic open palm */}
        <div className="absolute left-[5%] md:left-[10%] bottom-0 w-28 h-56 md:w-40 md:h-72">
          <svg viewBox="0 0 100 180" className="w-full h-full animate-hand-push-left">
            <defs>
              <radialGradient id="handGradientLeft" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.85)" />
                <stop offset="60%" stopColor="rgba(0,0,0,0.5)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
              <filter id="blurLeft" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
              </filter>
            </defs>
            {/* Realistic hand shape - open palm pressing */}
            <path
              d="M50 180 
                 C45 160, 40 150, 38 140
                 L35 120
                 C32 110, 28 100, 25 85
                 L22 65
                 C20 55, 18 45, 20 35
                 C22 28, 26 25, 28 30
                 L32 50
                 C33 55, 34 60, 35 65
                 L35 55
                 C35 45, 34 35, 36 25
                 C38 15, 42 12, 44 18
                 L46 40
                 C47 50, 47 55, 47 60
                 L48 45
                 C48 35, 48 25, 50 15
                 C52 5, 56 5, 58 12
                 L58 35
                 C58 45, 58 52, 58 58
                 L60 45
                 C60 35, 62 28, 65 22
                 C68 16, 72 18, 73 25
                 L72 45
                 C71 55, 70 60, 70 65
                 L73 55
                 C75 48, 78 45, 82 48
                 C86 52, 85 60, 82 72
                 L78 90
                 C75 105, 70 115, 68 125
                 L65 140
                 C62 155, 58 165, 55 180
                 Z"
              fill="url(#handGradientLeft)"
              filter="url(#blurLeft)"
            />
          </svg>
        </div>
        
        {/* Right hand - realistic open palm (mirrored) */}
        <div className="absolute right-[5%] md:right-[10%] bottom-0 w-28 h-56 md:w-40 md:h-72">
          <svg viewBox="0 0 100 180" className="w-full h-full animate-hand-push-right" style={{ transform: 'scaleX(-1)' }}>
            <defs>
              <radialGradient id="handGradientRight" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.85)" />
                <stop offset="60%" stopColor="rgba(0,0,0,0.5)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
              <filter id="blurRight" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
              </filter>
            </defs>
            <path
              d="M50 180 
                 C45 160, 40 150, 38 140
                 L35 120
                 C32 110, 28 100, 25 85
                 L22 65
                 C20 55, 18 45, 20 35
                 C22 28, 26 25, 28 30
                 L32 50
                 C33 55, 34 60, 35 65
                 L35 55
                 C35 45, 34 35, 36 25
                 C38 15, 42 12, 44 18
                 L46 40
                 C47 50, 47 55, 47 60
                 L48 45
                 C48 35, 48 25, 50 15
                 C52 5, 56 5, 58 12
                 L58 35
                 C58 45, 58 52, 58 58
                 L60 45
                 C60 35, 62 28, 65 22
                 C68 16, 72 18, 73 25
                 L72 45
                 C71 55, 70 60, 70 65
                 L73 55
                 C75 48, 78 45, 82 48
                 C86 52, 85 60, 82 72
                 L78 90
                 C75 105, 70 115, 68 125
                 L65 140
                 C62 155, 58 165, 55 180
                 Z"
              fill="url(#handGradientRight)"
              filter="url(#blurRight)"
            />
          </svg>
        </div>

        {/* Center shadow figure - like pressing against frosted glass */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-48 h-80 md:w-64 md:h-[420px]">
          <svg viewBox="0 0 200 320" className="w-full h-full animate-hand-push-center">
            <defs>
              <radialGradient id="bodyGradient" cx="50%" cy="25%" r="60%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.7)" />
                <stop offset="50%" stopColor="rgba(0,0,0,0.35)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
              <radialGradient id="headGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.6)" />
                <stop offset="70%" stopColor="rgba(0,0,0,0.25)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
              <filter id="blurBody" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="8" />
              </filter>
              <filter id="blurHead" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="12" />
              </filter>
            </defs>
            
            {/* Head silhouette */}
            <ellipse
              cx="100"
              cy="60"
              rx="35"
              ry="45"
              fill="url(#headGradient)"
              filter="url(#blurHead)"
            />
            
            {/* Body/shoulders silhouette */}
            <ellipse
              cx="100"
              cy="180"
              rx="70"
              ry="120"
              fill="url(#bodyGradient)"
              filter="url(#blurBody)"
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
