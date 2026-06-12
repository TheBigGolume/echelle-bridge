import 'dotenv/config';
import express        from 'express';
import { fileURLToPath } from 'url';
import { dirname, join  } from 'path';
import { connectDB, loadIPs, upsertIP, removeIP, loadPins, upsertPin } from './db.js';
import { sendToRoblox } from './roblox-bridge.js';
import { ACTIONS       } from './actions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── State ────────────────────────────────────────────────────────────────
const registeredIPs = new Map(); // ip → { username }
const userPins      = new Map(); // username → pin

const actionMap = {};
for (const a of ACTIONS) actionMap[a.action] = a;

// ─── Helpers ──────────────────────────────────────────────────────────────
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip;
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ─── Auth middleware ───────────────────────────────────────────────────────
function auth(req, res, next) {
  const ip = getClientIP(req);
  if (!registeredIPs.has(ip)) {
    return res.status(401).json({ error: 'IP non enregistrée', ip });
  }
  req.robloxUser = registeredIPs.get(ip).username;
  next();
}

// ─── Ping (pré-réveil Render) ─────────────────────────────────────────────
app.get('/ping', (_req, res) => res.send('pong'));

// ─── generate-pin (appelé par BridgeSetup Roblox) ─────────────────────────
app.get('/generate-pin', (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'user requis' });

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
  console.log(`[PIN] ${user} → ${pin}`);
  res.json({ pin });
});

// ─── register (visité par le joueur dans son navigateur) ──────────────────
app.get('/register', async (req, res) => {
  const { pin, user } = req.query;
  if (!pin || !user) return res.status(400).json({ error: 'pin et user requis' });

  const ip       = getClientIP(req);
  const expected = userPins.get(user);
  if (!expected || pin !== expected) {
    return res.status(403).send('❌ PIN invalide ou expiré.');
  }

  // Retire l'ancienne IP de cet utilisateur
  for (const [oldIp, info] of registeredIPs) {
    if (info.username === user && oldIp !== ip) {
      registeredIPs.delete(oldIp);
      removeIP(oldIp).catch(() => {});
      break;
    }
  }

  registeredIPs.set(ip, { username: user });
  await upsertIP(ip, { username: user }).catch(() => {});
  userPins.delete(user);

  console.log(`[Register] ${user} → ${ip}`);
  res.send(`
    <html><head><meta charset="utf-8">
    <style>body{font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
    .box{text-align:center;padding:2rem;background:#1a1a2e;border-radius:12px;border:2px solid #7c3aed;}
    h1{color:#a78bfa;}p{color:#ccc;}</style></head>
    <body><div class="box">
      <h1>✅ Enregistré !</h1>
      <p>Bienvenue <strong>${user}</strong> — tu peux fermer cet onglet et retourner dans le jeu.</p>
    </div></body></html>
  `);
});

// ─── unregister-user (appelé par BridgeSetup à la connexion / déconnexion) ─
app.get('/unregister-user', (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'user requis' });

  for (const [ip, info] of registeredIPs) {
    if (info.username === user) {
      registeredIPs.delete(ip);
      removeIP(ip).catch(() => {});
      break;
    }
  }
  userPins.delete(user);
  console.log(`[Unregister] ${user}`);
  res.json({ ok: true });
});

// ─── check-user (appelé par BridgeSetup pour vérifier l'enregistrement) ───
app.get('/check-user', (req, res) => {
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'user requis' });

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

// ─── Webhooks (authentifiés par IP) ──────────────────────────────────────
app.post('/webhook/*', auth, async (req, res) => {
  const parts  = req.path.split('/');
  const action = parts[2];

  if (!actionMap[action]) {
    return res.status(404).json({ error: `Action inconnue : ${action}` });
  }

  const payload = {
    action,
    robloxUser: req.robloxUser,
    ...(req.body || {}),
  };

  try {
    await sendToRoblox(payload);
    console.log(`[Webhook] ${req.robloxUser} → ${action}`);
    res.json({ ok: true, action });
  } catch (err) {
    console.error(`[Webhook] Erreur :`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Liste des actions (pour webhooks.html) ───────────────────────────────
app.get('/actions', (_req, res) => res.json(ACTIONS));

// ─── Démarrage ────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectDB();
    const [ips, pins] = await Promise.all([loadIPs(), loadPins()]);
    for (const { ip, username } of ips)      registeredIPs.set(ip, { username });
    for (const { username, pin } of pins)    userPins.set(username, pin);
    console.log(`[DB] ${ips.length} IP(s) et ${pins.length} PIN(s) chargés`);
  } catch {
    console.warn('[DB] MongoDB indisponible — fonctionnement en mémoire seule');
  }

  app.listen(PORT, () => {
    console.log(`[Echelle Bridge] Démarré sur le port ${PORT}`);
    console.log(`[Echelle Bridge] ${Object.keys(actionMap).length} actions disponibles`);
  });
}

start();
