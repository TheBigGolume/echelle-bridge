import 'dotenv/config';

const UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID;
const API_KEY     = process.env.ROBLOX_API_KEY;
const TOPIC       = 'EchelleEvent';
const MAX_CHARS   = 1000;
const MIN_DELAY   = 400; // ms anti-spam

let lastSent = 0;

export async function sendToRoblox(payload) {
  if (!UNIVERSE_ID || !API_KEY) {
    throw new Error('ROBLOX_UNIVERSE_ID ou ROBLOX_API_KEY manquant');
  }

  const json = JSON.stringify(payload);
  if (json.length > MAX_CHARS) {
    throw new Error(`Payload trop grand (${json.length} chars > ${MAX_CHARS})`);
  }

  const now  = Date.now();
  const wait = MIN_DELAY - (now - lastSent);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSent = Date.now();

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
