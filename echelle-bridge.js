import 'dotenv/config';
import express        from 'express';
import { fileURLToPath } from 'url';
import { dirname, join  } from 'path';
import { connectDB, loadIPs, upsertIP, removeIP, loadPins, upsertPin } from './db.js';
import { sendToRoblox } from './roblox-bridge.js';
import { ACTIONS       } from './actions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const PORT     = process.env.PORT || 3001;
const SEED_IPS = process.env.ALLOWED_IPS
    ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim()).filter(Boolean)
    : [];

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

// ─── State ────────────────────────────────────────────────────────────────
const registeredIPs = new Map(); // ip → { username }
const userPins      = new Map(); // username → pin

// IPs fixes depuis l'env (toujours autorisées, sans compte lié)
SEED_IPS.forEach(ip => registeredIPs.set(ip, { username: null }));

const actionMap = new Map(ACTIONS.map(a => [a.action, a]));

// ─── Helpers ──────────────────────────────────────────────────────────────
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip;
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function htmlPage(title, ok, msg) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { font-family: sans-serif; background: #0a0a14; color: #eee; padding: 40px; text-align: center; }
  h1   { color: ${ok ? '#4ade80' : '#f38ba8'}; }
  p    { color: #888; font-size: 15px; line-height: 1.6; }
  .box { background: #12121f; border: 1px solid #1e1e38; border-radius: 14px; padding: 28px 36px; display: inline-block; margin-top: 16px; }
</style></head>
<body><div class="box"><h1>${title}</h1><p>${msg}</p></div></body></html>`;
}

function registerSuccessPage(user) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion établie</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: #0a0a14; color: #e8e8f0;
    min-height: 100vh; display: flex;
    align-items: center; justify-content: center; padding: 24px;
  }
  .card {
    background: #12121f; border: 1px solid #1e1e38; border-radius: 20px;
    padding: 48px 40px 40px; max-width: 440px; width: 100%;
    text-align: center; box-shadow: 0 0 60px rgba(40,200,100,0.07);
  }
  .icon-wrap {
    width: 72px; height: 72px;
    background: rgba(40,200,100,0.12); border: 2px solid rgba(40,200,100,0.35);
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    margin: 0 auto 24px; font-size: 32px;
  }
  h1 { font-size: 24px; font-weight: 700; color: #4ade80; margin-bottom: 10px; }
  .sub { font-size: 15px; color: #8888aa; line-height: 1.55; margin-bottom: 32px; }
  .notice {
    background: rgba(250,190,40,0.07); border: 1px solid rgba(250,190,40,0.25);
    border-radius: 12px; padding: 16px 20px;
    display: flex; gap: 12px; align-items: flex-start; text-align: left;
  }
  .notice-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
  .notice-text { font-size: 13.5px; color: #c8b870; line-height: 1.6; }
  .notice-text strong { display: block; color: #f0d060; font-size: 14px; margin-bottom: 4px; }
  .back-btn {
    display: inline-block; margin-top: 28px; padding: 12px 28px;
    background: #1a2a1a; border: 1px solid rgba(40,200,100,0.3);
    border-radius: 10px; color: #4ade80; font-size: 14px; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">✓</div>
    <h1>Connexion établie !</h1>
    <p class="sub">Bienvenue <strong>${user}</strong> — tu es bien connecté au jeu.<br>Tu peux fermer cette page et reprendre.</p>
    <div class="notice">
      <span class="notice-icon">⚠️</span>
      <div class="notice-text">
        <strong>À refaire à chaque connexion</strong>
        Chaque fois que tu rejoins le jeu, tu dois ouvrir ce lien à nouveau. Sans ça, les actions webhook ne s'appliqueront pas sur toi.
      </div>
    </div>
    <div class="back-btn">↩ Retourne dans le jeu</div>
  </div>
</body>
</html>`;
}

// ─── Auth middleware ───────────────────────────────────────────────────────
function auth(req, res, next) {
  const ip = getClientIP(req);
  if (!registeredIPs.has(ip)) {
    console.warn(`[Auth] ✗ IP refusée : ${ip}`);
    return res.status(401).json({ error: 'IP non enregistrée', ip });
  }
  req.robloxUser = registeredIPs.get(ip).username;
  next();
}

// ─── Routes de base ───────────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/webhooks'));
app.get('/webhooks', (_req, res) => res.sendFile(join(__dirname, 'public', 'webhooks.html')));

// ─── Ping (pré-réveil Render) ─────────────────────────────────────────────
app.get('/ping', (_req, res) => res.send('pong'));

// ─── generate-pin (appelé par BridgeSetup Roblox) ─────────────────────────
app.get('/generate-pin', (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'user requis' });

  // Conserve le PIN existant si le joueur n'a pas encore enregistré son IP
  if (userPins.has(user)) {
    return res.json({ user, pin: userPins.get(user) });
  }

  // Nettoie l'ancienne IP si elle pointait vers cet utilisateur
  for (const [ip, info] of registeredIPs) {
    if (info.username === user) {
      registeredIPs.delete(ip);
      removeIP(ip).catch(() => {});
      break;
    }
  }

  const pin = generatePin();
  userPins.set(user, pin);
  upsertPin(user, pin).catch(() => {});
  console.log(`[PIN] Généré pour @${user} : ${pin}`);
  res.json({ user, pin });
});

// ─── register (visité par le joueur dans son navigateur) ──────────────────
app.get('/register', async (req, res) => {
  const { pin, user } = req.query;
  if (!pin || !user) return res.status(400).send(htmlPage('Paramètres manquants', false, 'Les paramètres <b>pin</b> et <b>user</b> sont requis.'));

  const ip       = getClientIP(req);
  const expected = userPins.get(user);

  if (!expected) {
    console.warn(`[Register] ✗ Aucun PIN connu pour @${user} depuis ${ip}`);
    return res.status(401).send(htmlPage('✗ Non autorisé', false,
      `Aucun PIN généré pour <b>@${user}</b>.<br>Rejoins le jeu d'abord pour obtenir ton lien.`));
  }
  if (pin !== expected) {
    console.warn(`[Register] ✗ Mauvais PIN pour @${user} depuis ${ip}`);
    return res.status(401).send(htmlPage('✗ PIN incorrect', false,
      `PIN incorrect pour <b>@${user}</b>.<br>Utilise le lien affiché dans le jeu.`));
  }

  // Retire l'ancienne IP de cet utilisateur
  for (const [oldIp, info] of registeredIPs) {
    if (info.username === user && oldIp !== ip) {
      registeredIPs.delete(oldIp);
      removeIP(oldIp).catch(() => {});
      console.log(`[Register] ↺ Ancienne IP supprimée : ${oldIp} → @${user}`);
      break;
    }
  }

  registeredIPs.set(ip, { username: user });
  await upsertIP(ip, { username: user }).catch(() => {});
  console.log(`[Register] ✓ ${ip} → @${user}`);

  res.send(registerSuccessPage(user));
});

// ─── unregister-user (appelé par BridgeSetup à la connexion / déconnexion) ─
app.get('/unregister-user', (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'user requis' });

  let found = false;
  for (const [ip, info] of registeredIPs) {
    if (info.username === user) {
      registeredIPs.delete(ip);
      removeIP(ip).catch(() => {});
      found = true;
      break;
    }
  }
  userPins.delete(user);
  console.log(`[Register] Session reset : @${user} ${found ? 'supprimé' : 'introuvable'}`);
  res.json({ cleared: found });
});

// ─── check-user (appelé par BridgeSetup pour vérifier l'enregistrement) ───
app.get('/check-user', (req, res) => {
  const user = req.query.user;
  if (!user) return res.json({ registered: false });

  for (const info of registeredIPs.values()) {
    if (info.username === user) return res.json({ registered: true });
  }
  res.json({ registered: false });
});

// ─── my-ip (debug) ────────────────────────────────────────────────────────
app.get('/my-ip', (req, res) => {
  const ip   = getClientIP(req);
  const info = registeredIPs.get(ip);
  res.json({ ip, registered: !!info, username: info?.username ?? null });
});

// ─── Liste des actions (pour webhooks.html) ───────────────────────────────
app.get('/actions', (_req, res) => res.json(ACTIONS));

// ─── Liste complète avec URLs (protégée) ──────────────────────────────────
app.get('/api/webhooks', auth, (req, res) => {
  const host = `${req.protocol}://${req.get('host')}`;
  res.json({
    webhooks: ACTIONS.map(({ action, label }) => ({
      action,
      label,
      url:    `${host}/webhook/${action}`,
      method: 'POST',
      body:   '{}',
    }))
  });
});

// ─── Webhooks (authentifiés par IP) ──────────────────────────────────────
app.post('/webhook/*', auth, async (req, res) => {
  const action = req.path.slice('/webhook/'.length);

  if (!actionMap.has(action)) {
    console.warn(`[Webhook] ✗ Action inconnue : "${action}"`);
    return res.status(404).json({ error: `Action inconnue : ${action}` });
  }

  const ip      = getClientIP(req);
  const stored  = registeredIPs.get(ip) || {};
  const payload = { action, robloxUser: stored.username || null, ...(req.body || {}) };

  console.log(`[Webhook] → ${action}  (roblox: ${stored.username || '?'} | ip: ${ip})`);

  try {
    await sendToRoblox(payload);
    res.json({ ok: true, action, robloxUser: stored.username });
  } catch (err) {
    console.error(`[Webhook] ✗ Erreur :`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Démarrage ────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectDB();
    const [ips, pins] = await Promise.all([loadIPs(), loadPins()]);
    for (const { ip, username } of ips)   registeredIPs.set(ip, { username });
    for (const { username, pin } of pins) userPins.set(username, pin);
    console.log(`[DB] ${ips.length} IP(s) et ${pins.length} PIN(s) chargés`);
  } catch {
    console.warn('[DB] MongoDB indisponible — fonctionnement en mémoire seule');
  }

  app.listen(PORT, () => {
    console.log(`\n[Echelle Bridge] ✓ Démarré sur le port ${PORT}`);
    console.log(`[Echelle Bridge]   ${actionMap.size} actions disponibles`);
    for (const action of actionMap.keys()) {
      console.log(`[Echelle Bridge]   POST /webhook/${action}`);
    }
    console.log(`[Echelle Bridge]   GET  /generate-pin`);
    console.log(`[Echelle Bridge]   GET  /register`);
    console.log(`[Echelle Bridge]   GET  /my-ip\n`);

  });
}

start();
