import fs from 'node:fs';
import { databaseError } from './database-errors.js';
const clean = value => typeof value === 'string' ? value.trim() : '';
export function parseObject(raw, reader = path => fs.readFileSync(path, 'utf8')) {
  if (!clean(raw)) return {};
  try {
    const text = raw.trim();
    let object = JSON.parse(text.startsWith('{') || text.startsWith('"') ? text : reader(text));
    if (typeof object === 'string') object = JSON.parse(object);
    if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('Invalid object');
    return object;
  } catch (cause) { throw databaseError('DB_CONFIG_INVALID', cause); }
}
export function resolveFirebaseOptions(env = process.env, applet = {}, reader) {
  // Preserve the V30 target. FIREBASE_CONFIG may supplement missing settings, not silently switch data.
  const injected = parseObject(env.FIREBASE_CONFIG || '', reader);
  const sourceProject = clean(applet.projectId), sourceDatabase = clean(applet.firestoreDatabaseId);
  const envProject = clean(env.FIREBASE_PROJECT_ID), envDatabase = clean(env.FIRESTORE_DATABASE_ID);
  const injectedProject = clean(injected.projectId), injectedDatabase = clean(injected.firestoreDatabaseId);
  if (!envProject && sourceProject && injectedProject && sourceProject !== injectedProject)
    throw databaseError('DB_TARGET_MISMATCH');
  if (!envDatabase && sourceDatabase && injectedDatabase && sourceDatabase !== injectedDatabase)
    throw databaseError('DB_TARGET_MISMATCH');
  const projectId = envProject || sourceProject || injectedProject || clean(env.GOOGLE_CLOUD_PROJECT) || clean(env.GCLOUD_PROJECT);
  const databaseId = envDatabase || sourceDatabase || injectedDatabase || '(default)';
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw databaseError('DB_CONFIG_INVALID');
  if (databaseId !== '(default)' && !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(databaseId)) throw databaseError('DB_CONFIG_INVALID');
  return { projectId, databaseId };
}
export function readServiceCredential(env = process.env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_ADMIN_CREDENTIALS || env.FIREBASE_ADMIN_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const email = clean(env.FIREBASE_CLIENT_EMAIL || env.FIREBASE_ADMIN_CLIENT_EMAIL);
  const key = clean(env.FIREBASE_PRIVATE_KEY || env.FIREBASE_ADMIN_PRIVATE_KEY);
  if (!raw && !b64 && !email && !key) return null;
  try {
    let object;
    if (raw || b64) {
      object = JSON.parse(raw || Buffer.from(b64, 'base64').toString('utf8'));
      if (typeof object === 'string') object = JSON.parse(object);
    } else object = { client_email: email, private_key: key, project_id: clean(env.FIREBASE_PROJECT_ID) };
    if (!object || typeof object !== 'object' || typeof object.client_email !== 'string' || typeof object.private_key !== 'string' || !object.client_email.trim() || !object.private_key.trim()) throw new Error('Invalid credential');
    return { ...object, private_key: object.private_key.replace(/\\n/g, '\n').trim() };
  } catch (cause) { throw databaseError('DB_CREDENTIALS_UNAVAILABLE', cause); }
}
