import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "..", "data", "local-database.json");

let memoryDb = {};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const text = fs.readFileSync(DB_FILE, "utf8");
      memoryDb = JSON.parse(text);
    } else {
      memoryDb = {};
    }
  } catch (err) {
    console.warn("[LocalStore] Không đọc được file database, khởi tạo mới:", err.message);
    memoryDb = {};
  }
}

function saveDb() {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(memoryDb, null, 2), "utf8");
  } catch (err) {
    console.error("[LocalStore] Lưu file database thất bại:", err.message);
  }
}

loadDb();

function clone(val) {
  if (val === undefined) return undefined;
  return JSON.parse(JSON.stringify(val));
}

class DocumentReference {
  constructor(collectionName, id) {
    this.collectionName = String(collectionName);
    this.id = String(id);
    this.path = `${this.collectionName}/${this.id}`;
  }

  async get() {
    const col = memoryDb[this.collectionName] || {};
    const hasDoc = Object.prototype.hasOwnProperty.call(col, this.id);
    const data = hasDoc ? clone(col[this.id]) : null;
    return {
      id: this.id,
      exists: hasDoc,
      data: () => clone(data)
    };
  }

  async set(data, options = {}) {
    if (!memoryDb[this.collectionName]) {
      memoryDb[this.collectionName] = {};
    }
    if (options.merge && memoryDb[this.collectionName][this.id]) {
      memoryDb[this.collectionName][this.id] = {
        ...memoryDb[this.collectionName][this.id],
        ...clone(data)
      };
    } else {
      memoryDb[this.collectionName][this.id] = clone(data);
    }
    saveDb();
    return { writeTime: new Date() };
  }

  async delete() {
    if (memoryDb[this.collectionName]) {
      delete memoryDb[this.collectionName][this.id];
      saveDb();
    }
    return { writeTime: new Date() };
  }
}

class Query {
  constructor(collectionName, filters = [], sortRules = [], limitCount = null) {
    this.collectionName = String(collectionName);
    this.filters = filters;
    this.sortRules = sortRules;
    this.limitCount = limitCount;
  }

  where(field, op, value) {
    return new Query(
      this.collectionName,
      [...this.filters, { field, op, value }],
      this.sortRules,
      this.limitCount
    );
  }

  orderBy(field, direction = "asc") {
    return new Query(
      this.collectionName,
      this.filters,
      [...this.sortRules, { field, direction }],
      this.limitCount
    );
  }

  limit(count) {
    return new Query(
      this.collectionName,
      this.filters,
      this.sortRules,
      count
    );
  }

  async get() {
    const col = memoryDb[this.collectionName] || {};
    let docs = Object.entries(col).map(([id, data]) => ({
      id,
      data: clone(data)
    }));

    for (const f of this.filters) {
      docs = docs.filter(doc => {
        const val = doc.data?.[f.field];
        if (f.op === "==") return val === f.value;
        if (f.op === "!=") return val !== f.value;
        if (f.op === ">") return val > f.value;
        if (f.op === ">=") return val >= f.value;
        if (f.op === "<") return val < f.value;
        if (f.op === "<=") return val <= f.value;
        return true;
      });
    }

    for (const s of this.sortRules) {
      docs.sort((a, b) => {
        const valA = a.data?.[s.field] ?? "";
        const valB = b.data?.[s.field] ?? "";
        if (valA === valB) return 0;
        const cmp = valA > valB ? 1 : -1;
        return s.direction === "desc" ? -cmp : cmp;
      });
    }

    if (this.limitCount !== null && this.limitCount !== undefined) {
      docs = docs.slice(0, this.limitCount);
    }

    return {
      docs: docs.map(d => ({
        id: d.id,
        exists: true,
        data: () => clone(d.data)
      })),
      size: docs.length,
      empty: docs.length === 0
    };
  }
}

class CollectionReference extends Query {
  constructor(collectionName) {
    super(collectionName);
  }

  doc(id) {
    return new DocumentReference(this.collectionName, id);
  }

  async add(data) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const docRef = this.doc(id);
    await docRef.set(data);
    return { id, path: docRef.path };
  }
}

class WriteBatch {
  constructor() {
    this.ops = [];
  }

  set(docRef, data, options = {}) {
    this.ops.push({ type: "set", docRef, data, options });
    return this;
  }

  delete(docRef) {
    this.ops.push({ type: "delete", docRef });
    return this;
  }

  async commit() {
    for (const op of this.ops) {
      if (op.type === "set") {
        await op.docRef.set(op.data, op.options);
      } else if (op.type === "delete") {
        await op.docRef.delete();
      }
    }
    return true;
  }
}

class Transaction {
  async get(docRef) {
    return docRef.get();
  }

  set(docRef, data, options = {}) {
    docRef.set(data, options);
    return this;
  }

  delete(docRef) {
    docRef.delete();
    return this;
  }
}

export class LocalFirestore {
  collection(name) {
    return new CollectionReference(name);
  }

  batch() {
    return new WriteBatch();
  }

  async runTransaction(updateFunction) {
    const tx = new Transaction();
    return await updateFunction(tx);
  }

  settings() {
    // no-op
  }
}

export const localDb = new LocalFirestore();
