// Sonido corto de "enviado" (generado, sin archivos) y vibración breve en Android.
// El audio se prepara en el mismo toque del botón: los navegadores solo dejan sonar
// después de una acción de la persona. En iPhone respeta el modo silencio.
let ctx: AudioContext | null = null;

export function prepararSonido() {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new C();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
}

export function sonarEnviado() {
  try { navigator.vibrate?.([60, 40, 60]); } catch { /* */ }
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  [[660, 0], [880, 0.12]].forEach(([f, d]) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.28);
    o.connect(g).connect(ctx!.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.3);
  });
}
