import 'dotenv/config';
import fs from 'node:fs';
import { cert, applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { storagePlan } from './storage-config.js';
import { resolveFirebaseOptions, readServiceCredential, parseObject } from './firebase-options.js';
import { databaseError, classifyDatabaseError, createDatabaseProbe } from './database-errors.js';

export let firebaseProjectId = '';
export let firestoreDatabaseId = '(default)';
let plan = { backend: 'unavailable' }, credentialSource = 'unavailable', firestoreInstance = null;
let initializationError = null, store = null;
try {
  try { plan = storagePlan(); } catch (cause) { throw databaseError('DB_UNSAFE_STORAGE', cause); }
  if (plan.backend === 'firestore') {
    const filename = new URL('../firebase-applet-config.json', import.meta.url);
    const applet = fs.existsSync(filename) ? parseObject(fs.readFileSync(filename, 'utf8')) : {};
    const options = resolveFirebaseOptions(process.env, applet);
    firebaseProjectId = options.projectId; firestoreDatabaseId = options.databaseId;
    const serviceCredential = readServiceCredential();
    const credential = serviceCredential ? cert({ ...serviceCredential, project_id: serviceCredential.project_id || firebaseProjectId }) : applicationDefault();
    credentialSource = serviceCredential ? 'service_account' : 'application_default';
    const appName = 'htx-server';
    const app = getApps().some(a => a.name === appName) ? getApp(appName) : initializeApp({ credential, projectId: firebaseProjectId }, appName);
    if (app.options.projectId !== firebaseProjectId) throw databaseError('DB_TARGET_MISMATCH');
    firestoreInstance = firestoreDatabaseId === '(default)' ? getFirestore(app) : getFirestore(app, firestoreDatabaseId);
    firestoreInstance.settings({ ignoreUndefinedProperties: true });
    store = firestoreInstance;
  } else {
    store = (await import('./local-store.js')).localDb;
    credentialSource = 'local_store';
  }
} catch (cause) {
  initializationError = databaseError(classifyDatabaseError(cause) || 'DB_CONFIG_INVALID', cause);
  // The login page stays reachable to report setup errors. No usable fallback database is created.
  console.error(JSON.stringify({ event: 'HTX_DATABASE_INITIALIZATION', code: initializationError.code }));
}
const unavailable = () => { throw initializationError || databaseError('DB_UNAVAILABLE'); };
export const db = store || { collection: unavailable, runTransaction: unavailable, batch: unavailable, settings: unavailable };
export function getFirebaseDiagnostics() {
  return { initialized: !initializationError, isCloudFirestore: !!firestoreInstance, backend: plan.backend,
    projectId: firebaseProjectId || null, databaseId: firestoreDatabaseId, credentialSource,
    localStoreEnabled: plan.backend === 'local' && !initializationError,
    durable: !!firestoreInstance || process.env.HTX_LOCAL_DURABLE === 'true',
    missing: [], error: initializationError?.message || null, code: initializationError?.code || null };
}
const probe = createDatabaseProbe(() => db.collection('config').doc('bootstrap').get());
export async function verifyFirebaseConnection() { return { ...getFirebaseDiagnostics(), ...await probe() }; }
