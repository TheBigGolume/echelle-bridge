import { MongoClient } from 'mongodb';

const URI    = process.env.MONGODB_URI;
let   client = null;
let   db     = null;

export async function connectDB() {
  if (!URI) throw new Error('MONGODB_URI non défini');
  client = new MongoClient(URI);
  await client.connect();
  db = client.db('echelle-roblox');
  console.log('[DB] Connecté à MongoDB — echelle-roblox');
}

export async function loadIPs() {
  if (!db) return [];
  return db.collection('registered_ips').find().toArray();
}

export async function upsertIP(ip, info) {
  if (!db) return;
  await db.collection('registered_ips').updateOne(
    { ip },
    { $set: { ip, ...info } },
    { upsert: true }
  );
}

export async function removeIP(ip) {
  if (!db) return;
  await db.collection('registered_ips').deleteOne({ ip });
}

export async function loadPins() {
  if (!db) return [];
  return db.collection('user_pins').find().toArray();
}

export async function upsertPin(username, pin) {
  if (!db) return;
  await db.collection('user_pins').updateOne(
    { username },
    { $set: { username, pin } },
    { upsert: true }
  );
}
