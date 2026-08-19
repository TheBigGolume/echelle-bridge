import 'dotenv/config';

const UNIVERSE_ID  = process.env.ROBLOX_UNIVERSE_ID;
const API_KEY      = process.env.ROBLOX_API_KEY;
const TOPIC        = 'EchelleEvent';
const MAX_CHARS    = 1000;
const FLUSH_DELAY  = 400; // ms — espacement mini entre deux envois à Roblox (~150/min, limite MessagingService)

// ─── File d'attente + regroupement ──────────────────────────────────────
// Une action isolée part immédiatement (délai 0). En cas de rafale
// (plusieurs webhooks à moins de FLUSH_DELAY d'écart), elles sont
// regroupées dans UN SEUL message envoyé au prochain créneau autorisé,
// au lieu d'être mises bout à bout (ce qui ferait attendre la Nème
// action N × FLUSH_DELAY).
let queue      = [];
let flushTimer = null;
let lastFlush  = 0;

function chunkPayloads(items) {
  const chunks  = [];
  let current   = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (JSON.stringify(candidate).length > MAX_CHARS && current.length > 0) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function publishRaw(json) {
  const url = `https://apis.roblox.com/messaging-service/v1/universes/${UNIVERSE_ID}/topics/${TOPIC}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    API_KEY,
    },
    body: JSON.stringify({ message: json }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Roblox API ${res.status}: ${text}`);
  }
}

async function flush() {
  const items = queue;
  queue       = [];
  flushTimer  = null;
  lastFlush   = Date.now();

  for (const chunk of chunkPayloads(items)) {
    try {
      await publishRaw(JSON.stringify({ batch: chunk }));
    } catch (err) {
      console.error('[RobloxBridge] Erreur publish batch:', err.message);
    }
  }
}

// Ne bloque plus la réponse HTTP du webhook déclencheur : l'action est mise
// en file et part immédiatement (ou groupée avec les autres si ça spam).
export function sendToRoblox(payload) {
  if (!UNIVERSE_ID || !API_KEY) {
    return Promise.reject(new Error('ROBLOX_UNIVERSE_ID ou ROBLOX_API_KEY manquant'));
  }

  const json = JSON.stringify(payload);
  if (json.length > MAX_CHARS) {
    return Promise.reject(new Error(`Payload trop grand (${json.length} chars > ${MAX_CHARS})`));
  }

  queue.push(payload);

  if (!flushTimer) {
    const sinceLastFlush = Date.now() - lastFlush;
    if (sinceLastFlush >= FLUSH_DELAY) {
      flush(); // rien envoyé récemment → part tout de suite
    } else {
      flushTimer = setTimeout(flush, FLUSH_DELAY - sinceLastFlush);
    }
  }

  return Promise.resolve();
}
