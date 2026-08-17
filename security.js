// En-têtes de sécurité de base + rate limiting en mémoire par IP.
// Même approche légère que sur golum-site (pas de dépendance supplémentaire).

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset < now) buckets.delete(key);
}, 60_000).unref();

export function rateLimit({ windowMs = 60_000, max = 30, keyPrefix = 'global' } = {}) {
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) { bucket = { count: 0, reset: now + windowMs }; buckets.set(key, bucket); }
    bucket.count++;
    if (bucket.count > max) return res.status(429).json({ error: 'rate_limited' });
    next();
  };
}
