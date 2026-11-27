import React, { useEffect, useRef } from 'react';

export default function VoiceWaveCanvas({
  active = false,
  callPhase = 'idle',
  darkMode = true,
  logoRef = null
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ active, callPhase, darkMode });
  stateRef.current = { active, callPhase, darkMode };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let emblemCenterY = null;
    let phase = 0;
    let currentAmplitude = 4;
    let targetAmplitude = 4;
    let rafId = 0;
    let pulseTimer = 0;
    let lastDrawTime = 0;

    function measureCenterY() {
      if (!logoRef?.current) {
        emblemCenterY = null;
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const logoRect = logoRef.current.getBoundingClientRect();
      if (canvasRect.height > 0 && logoRect.height > 0) {
        const relY = (logoRect.top + logoRect.height * 0.5) - canvasRect.top;
        if (relY > 40 && relY < canvasRect.height - 40) {
          emblemCenterY = relY;
          return;
        }
      }
      emblemCenterY = null;
    }

    function drawStaticLine() {
      const { darkMode: isDark } = stateRef.current;
      ctx.clearRect(0, 0, width, height);
      const centerY = emblemCenterY !== null ? emblemCenterY : height * 0.44;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(24, 28, 38, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function updateSize() {
      const parent = canvas.parentElement;
      const nextW = parent ? parent.clientWidth : window.innerWidth;
      const nextH = parent ? parent.clientHeight : window.innerHeight;
      width = Math.max(1, nextW);
      height = Math.max(1, nextH);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      measureCenterY();
      if (!stateRef.current.active || prefersReducedMotion) {
        drawStaticLine();
      }
    }

    function animate(now = performance.now()) {
      if (!stateRef.current.active || prefersReducedMotion) return;

      if (lastDrawTime && (now - lastDrawTime) < 24) {
        rafId = window.requestAnimationFrame(animate);
        return;
      }
      lastDrawTime = now;

      if (typeof document !== 'undefined' && document.hidden) {
        rafId = window.requestAnimationFrame(animate);
        return;
      }

      const { darkMode: isDark } = stateRef.current;
      const rgb = isDark ? '255, 255, 255' : '24, 28, 38';

      ctx.clearRect(0, 0, width, height);
      currentAmplitude += (targetAmplitude - currentAmplitude) * 0.16;
      phase += 0.09;

      const centerY = emblemCenterY !== null ? emblemCenterY : height * 0.44;
      const centerX = width * 0.5;
      const maxDist = Math.max(120, width * 0.45);

      if (logoRef?.current) {
        const scale = 1 + (currentAmplitude / 500);
        logoRef.current.style.transform = `scale(${scale.toFixed(3)})`;
      }

      const layers = [
        { freq: 0.014, speed: 1, alpha: isDark ? 0.85 : 0.42, width: 2, mult: 1 },
        { freq: 0.024, speed: -1.2, alpha: isDark ? 0.35 : 0.18, width: 1.2, mult: 0.7 }
      ];

      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers[i];
        ctx.beginPath();
        for (let x = 0; x <= width; x += 6) {
          const dist = Math.abs(x - centerX);
          const env = Math.max(0, 1 - (dist / maxDist));
          const y = Math.sin(x * layer.freq + phase * layer.speed) * currentAmplitude * layer.mult * env;
          if (x === 0) {
            ctx.moveTo(x, centerY + y);
          } else {
            ctx.lineTo(x, centerY + y);
          }
        }
        ctx.strokeStyle = `rgba(${rgb}, ${layer.alpha})`;
        ctx.lineWidth = layer.width;
        ctx.stroke();
      }

      rafId = window.requestAnimationFrame(animate);
    }

    updateSize();
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(canvas.parentElement);
    } else {
      window.addEventListener('resize', updateSize);
    }

    if (active && !prefersReducedMotion) {
      pulseTimer = window.setInterval(() => {
        const { callPhase: p } = stateRef.current;
        if (p === 'speaking') {
          targetAmplitude = Math.random() > 0.25 ? (Math.random() * 65 + 30) : 12;
        } else if (p === 'listening' || p === 'recording') {
          targetAmplitude = Math.random() * 24 + 20;
        } else if (p === 'thinking' || p === 'connecting') {
          targetAmplitude = 16;
        } else {
          targetAmplitude = 14;
        }
        measureCenterY();
      }, 170);
      animate();
    } else {
      if (logoRef?.current) {
        logoRef.current.style.transform = 'scale(1)';
      }
      drawStaticLine();
    }

    return () => {
      if (pulseTimer) window.clearInterval(pulseTimer);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', updateSize);
      }
      if (logoRef?.current) {
        logoRef.current.style.transform = '';
      }
    };
  }, [active, darkMode, logoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="voice-wave-canvas"
      data-testid="voice-wave-canvas"
      aria-hidden="true"
    />
  );
}
