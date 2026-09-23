import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.HTX_LOCAL_DB_PATH || path.join(__dirname, '..', 'data', 'local-database.json');
// Never silently replace a corrupt/unreadable database with an empty database.
let memoryDb = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {};
let writeQueue = Promise.resolve();
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function serialize(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}
function persist(next) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  // V30 rolling local snapshot on the SAME persistent disk (not disaster backup).
  if(fs.existsSync(DB_FILE))fs.copyFileSync(DB_FILE,DB_FILE+'.previous');
  const tmp = `${DB_FILE}.${randomUUID()}.tmp`;
  try { const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(next,null,2),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,DB_FILE); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  memoryDb = next;
}
function apply(ops) {
  const next = clone(memoryDb);
  for (const op of ops) {
    const { collectionName, id } = op.ref;
    if (!Object.hasOwn(next, collectionName)) next[collectionName] = {};
    if (op.type === 'delete') delete next[collectionName][id];
    else next[collectionName][id] = op.options?.merge && Object.hasOwn(next[collectionName], id)
      ? { ...next[collectionName][id], ...clone(op.data) } : clone(op.data);
  }
  persist(next);
}
function safeKey(value) {
  const key = String(value);
  if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Invalid database key');
  return key;
}
class DocumentReference {
  constructor(collectionName, id) { this.collectionName = safeKey(collectionName); this.id = safeKey(id); this.path = `${this.collectionName}/${this.id}`; }
  async get() {
    const col = memoryDb[this.collectionName] || {};
    const exists = Object.hasOwn(col, this.id);
    const data = exists ? clone(col[this.id]) : null;
    return { id: this.id, exists, data: () => clone(data) };
  }
  async set(data, options = {}) { return serialize(() => { apply([{ type: 'set', ref: this, data, options }]); return { writeTime: new Date() }; }); }
  async delete() { return serialize(() => { apply([{ type: 'delete', ref: this }]); return { writeTime: new Date() }; }); }
}
class Query {
  constructor(collectionName, filters = [], sortRules = [], limitCount = null) { Object.assign(this, { collectionName: safeKey(collectionName), filters, sortRules, limitCount }); }
  where(field, op, value) { return new Query(this.collectionName, [...this.filters, { field, op, value }], this.sortRules, this.limitCount); }
  orderBy(field, direction = 'asc') { return new Query(this.collectionName, this.filters, [...this.sortRules, { field, direction }], this.limitCount); }
  limit(count) { return new Query(this.collectionName, this.filters, this.sortRules, count); }
  async get() {
    let docs = Object.entries(memoryDb[this.collectionName] || {}).map(([id, data]) => ({ id, data: clone(data) }));
    for (const f of this.filters) docs = docs.filter(doc => {
      const val = doc.data?.[f.field];
      if (f.op === '==') return val === f.value;
      if (f.op === '!=') return val !== f.value;
      if (f.op === '>') return val > f.value;
      if (f.op === '>=') return val >= f.value;
      if (f.op === '<') return val < f.value;
      if (f.op === '<=') return val <= f.value;
      throw new Error('Unsupported query operator');
    });
    for (const s of this.sortRules) docs.sort((a, b) => {
      const va = a.data?.[s.field] ?? '', vb = b.data?.[s.field] ?? '';
      const cmp = va === vb ? 0 : va > vb ? 1 : -1;
      return s.direction === 'desc' ? -cmp : cmp;
    });
    if (this.limitCount !== null) docs = docs.slice(0, this.limitCount);
    return { docs: docs.map(d => ({ id: d.id, exists: true, data: () => clone(d.data) })), size: docs.length, empty: docs.length === 0 };
  }
}
class CollectionReference extends Query {
  doc(id) { return new DocumentReference(this.collectionName, id); }
  async add(data) { const ref = this.doc(randomUUID()); await ref.set(data); return { id: ref.id, path: ref.path }; }
}
class WriteBatch {
  constructor() { this.ops = []; }
  set(ref, data, options = {}) { this.ops.push({ type: 'set', ref, data, options }); return this; }
  delete(ref) { this.ops.push({ type: 'delete', ref }); return this; }
  async commit() { return serialize(() => { apply(this.ops); return true; }); }
}
class Transaction extends WriteBatch { async get(ref) { return ref.get(); } }
export class LocalFirestore {
  collection(name) { return new CollectionReference(name); }
  batch() { return new WriteBatch(); }
  async runTransaction(fn) {
    return serialize(async () => { const tx = new Transaction(); const result = await fn(tx); if (tx.ops.length) apply(tx.ops); return result; });
  }
  settings() {}
}
export const localDb = new LocalFirestore();
