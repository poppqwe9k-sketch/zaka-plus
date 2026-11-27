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
    let currentAmplitude = 7;
    let targetAmplitude = 7;
    let rafId = 0;
    let lastDrawTime = 0;

    const particles = Array.from({ length: 44 }, () => ({
      rx: Math.random(),
      ry: (Math.random() - 0.5) * 180,
      size: Math.random() * 1.8 + 0.6,
      speedX: (Math.random() - 0.5) * 0.0007,
      alpha: Math.random() * 0.65 + 0.2
    }));

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

    function updateSize() {
      const parent = canvas.parentElement;
      const nextW = parent ? parent.clientWidth : window.innerWidth;
      const nextH = parent ? parent.clientHeight : window.innerHeight;
      width = Math.max(1, nextW);
      height = Math.max(1, nextH);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const targetCanvasW = Math.floor(width * dpr);
      const targetCanvasH = Math.floor(height * dpr);
      if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
        canvas.width = targetCanvasW;
        canvas.height = targetCanvasH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      measureCenterY();
    }

    updateSize();
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(canvas.parentElement);
    } else {
      window.addEventListener('resize', updateSize);
    }

    const burstTimer = window.setInterval(() => {
      const { active: isCall, callPhase: p } = stateRef.current;
      if (!isCall) {
        targetAmplitude = 6.5;
      } else if (p === 'speaking') {
        const isBurst = Math.random() > 0.22;
        targetAmplitude = isBurst ? (Math.random() * 68 + 38) : 18;
      } else if (p === 'listening' || p === 'recording') {
        targetAmplitude = Math.random() * 24 + 20;
      } else if (p === 'thinking' || p === 'connecting') {
        targetAmplitude = 18;
      } else {
        targetAmplitude = 9;
      }
      measureCenterY();
    }, 170);

    function drawFrame(now = performance.now()) {
      const { active: isCall, callPhase: p, darkMode: isDark } = stateRef.current;
      if (!prefersReducedMotion) {
        const minInterval = isCall ? 24 : 36;
        if (lastDrawTime && (now - lastDrawTime) < minInterval) {
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }
        lastDrawTime = now;
      }

      if (typeof document !== 'undefined' && document.hidden) {
        if (!prefersReducedMotion) {
          rafId = window.requestAnimationFrame(drawFrame);
        }
        return;
      }

      const rgb = isDark ? '255, 255, 255' : '24, 28, 38';
      const isEnergetic = isCall && (p === 'speaking' || p === 'listening' || p === 'recording');

      ctx.clearRect(0, 0, width, height);

      currentAmplitude += (targetAmplitude - currentAmplitude) * 0.16;
      phase += isEnergetic ? 0.1 : (isCall ? 0.055 : 0.032);

      const centerY = emblemCenterY !== null ? emblemCenterY : height * 0.44;
      const centerX = width * 0.5;

      if (logoRef?.current) {
        if (isCall && !prefersReducedMotion) {
          const scale = 1 + (currentAmplitude / 450);
          logoRef.current.style.transform = `scale(${scale.toFixed(3)})`;
        } else {
          logoRef.current.style.transform = 'scale(1)';
        }
      }

      // Floating glowing particles
      for (const pt of particles) {
        if (!prefersReducedMotion) {
          pt.rx += pt.speedX * (isEnergetic ? 2.5 : 0.6);
          if (pt.rx < 0) pt.rx = 1;
          if (pt.rx > 1) pt.rx = 0;
        }
        const px = pt.rx * width;
        const spread = isEnergetic ? currentAmplitude * 1.35 : 34;
        const drawY = centerY + Math.sin(px * 0.01 + phase) * (spread * 0.6) + pt.ry * 0.35;

        ctx.beginPath();
        ctx.arc(px, drawY, pt.size, 0, Math.PI * 2);
        const alpha = isEnergetic ? pt.alpha : pt.alpha * (isDark ? 0.28 : 0.16);
        ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
        ctx.fill();
      }

      // Layered acoustic wave lines (fast 2-pass soft glow without CPU shadowBlur)
      const waveLayers = [
        { freq: 0.012, speed: 1, alpha: isDark ? (isCall ? 0.88 : 0.24) : (isCall ? 0.45 : 0.14), lineWidth: isCall ? 2 : 1.25, ampMult: 1.0, halo: isCall },
        { freq: 0.022, speed: -1.3, alpha: isDark ? (isCall ? 0.44 : 0.14) : (isCall ? 0.25 : 0.09), lineWidth: 1.15, ampMult: 0.75, halo: false },
        { freq: 0.008, speed: 0.7, alpha: isDark ? (isCall ? 0.24 : 0.09) : (isCall ? 0.15 : 0.06), lineWidth: 1, ampMult: 1.25, halo: false }
      ];

      const step = width > 900 ? 6 : 4;
      const maxDist = Math.max(120, width * 0.48);

      for (const layer of waveLayers) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += step) {
          const distFromCenter = Math.abs(x - centerX);
          const envelope = Math.max(0, 1 - Math.pow(distFromCenter / maxDist, 2));
          const yOffset = Math.sin(x * layer.freq + phase * layer.speed)
            * Math.cos(x * 0.005 - phase)
            * currentAmplitude
            * layer.ampMult
            * envelope;
          if (x === 0) {
            ctx.moveTo(x, centerY + yOffset);
          } else {
            ctx.lineTo(x, centerY + yOffset);
          }
        }
        if (layer.halo) {
          ctx.strokeStyle = `rgba(${rgb}, ${isDark ? 0.18 : 0.08})`;
          ctx.lineWidth = layer.lineWidth + 6;
          ctx.stroke();
        }
        ctx.strokeStyle = `rgba(${rgb}, ${layer.alpha})`;
        ctx.lineWidth = layer.lineWidth;
        ctx.stroke();
      }

      // Equalizer vertical bars framing the central emblem (batched into 2 opacity tiers)
      const halfBand = Math.min(320, width * 0.44);
      const barSpacing = 9;
      const baseBarAlpha = isCall ? 0.34 : 0.12;
      const tiers = [
        { minEnv: 0.48, maxEnv: 1.01, alpha: baseBarAlpha * 0.9 },
        { minEnv: 0.05, maxEnv: 0.48, alpha: baseBarAlpha * 0.42 }
      ];

      ctx.lineWidth = 1.5;
      for (const tier of tiers) {
        ctx.beginPath();
        for (let x = centerX - halfBand; x <= centerX + halfBand; x += barSpacing) {
          const distFromCenter = Math.abs(x - centerX);
          if (distFromCenter < 74) continue;
          const envelope = Math.max(0, 1 - (distFromCenter / halfBand));
          if (envelope < tier.minEnv || envelope >= tier.maxEnv) continue;
          const barHeight = Math.abs(Math.sin(x * 0.04 + phase * 1.5)) * currentAmplitude * 0.85 * envelope;
          ctx.moveTo(x, centerY - barHeight);
          ctx.lineTo(x, centerY + barHeight);
        }
        ctx.strokeStyle = `rgba(${rgb}, ${tier.alpha})`;
        ctx.stroke();
      }

      if (!prefersReducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    }

    drawFrame();

    return () => {
      window.clearInterval(burstTimer);
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
  }, [logoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="voice-wave-canvas"
      data-testid="voice-wave-canvas"
      aria-hidden="true"
    />
  );
}
