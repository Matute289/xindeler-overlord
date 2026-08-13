function sanitizeDmEvent(dmEvent) {
  const sanitized = { ...dmEvent };
  const diff = [];

  if (typeof sanitized.intensity === 'number') {
    const clamped = Math.min(10, Math.max(0, sanitized.intensity));
    if (clamped !== sanitized.intensity) {
      diff.push({ field: 'intensity', from: sanitized.intensity, to: clamped });
      sanitized.intensity = clamped;
    }
  }

  if (typeof sanitized.radius === 'number') {
    const clamped = Math.min(100, Math.max(1, sanitized.radius));
    if (clamped !== sanitized.radius) {
      diff.push({ field: 'radius', from: sanitized.radius, to: clamped });
      sanitized.radius = clamped;
    }
  }

  return { sanitized, diff };
}

module.exports = { sanitizeDmEvent };
