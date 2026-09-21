import { cert, applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { localDb } from "./local-store.js";

let firestoreInstance = null;
let firestoreFailed = false;
let authInstance = null;

function parseServiceAccount(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj.private_key) obj.private_key = obj.private_key.replace(/\\n/g, "\n");
    return obj;
  } catch (err) {
    console.warn("[Firebase] Không thể parse FIREBASE_SERVICE_ACCOUNT_JSON:", err.message);
    return null;
  }
}

try {
  if (!getApps().length) {
    const serviceAccount = parseServiceAccount();
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT;

    initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      ...(projectId ? { projectId } : {})
    });
  }

  firestoreInstance = getFirestore();
  firestoreInstance.settings({ ignoreUndefinedProperties: true });
  authInstance = getAuth();
} catch (err) {
  console.warn("[Firebase] Khởi tạo Firebase Admin SDK không thành công, sử dụng LocalStore:", err.message);
  firestoreFailed = true;
}

function switchToLocal(err) {
  if (!firestoreFailed) {
    firestoreFailed = true;
    console.warn("[Firebase] Cloud Firestore không khả dụng (" + (err?.message || "offline") + "). Tự động chuyển sang LocalStore.");
  }
}

export const db = {
  settings(opts) {
    if (!firestoreFailed && firestoreInstance) {
      try {
        firestoreInstance.settings(opts);
      } catch (err) {
        switchToLocal(err);
      }
    }
  },

  collection(name) {
    if (firestoreFailed || !firestoreInstance) {
      return localDb.collection(name);
    }

    const fsCol = firestoreInstance.collection(name);
    const localCol = localDb.collection(name);

    return {
      doc(id) {
        if (firestoreFailed) return localCol.doc(id);
        const fsDoc = fsCol.doc(String(id));
        const localDoc = localCol.doc(id);

        return {
          id: String(id),
          collectionName: name,
          get path() {
            return `${name}/${id}`;
          },
          async get() {
            if (firestoreFailed) return localDoc.get();
            try {
              return await fsDoc.get();
            } catch (err) {
              switchToLocal(err);
              return await localDoc.get();
            }
          },
          async set(data, options) {
            if (firestoreFailed) return localDoc.set(data, options);
            try {
              return await fsDoc.set(data, options);
            } catch (err) {
              switchToLocal(err);
              return await localDoc.set(data, options);
            }
          },
          async delete() {
            if (firestoreFailed) return localDoc.delete();
            try {
              return await fsDoc.delete();
            } catch (err) {
              switchToLocal(err);
              return await localDoc.delete();
            }
          }
        };
      },

      async add(data) {
        if (firestoreFailed) return localCol.add(data);
        try {
          return await fsCol.add(data);
        } catch (err) {
          switchToLocal(err);
          return await localCol.add(data);
        }
      },

      async get() {
        if (firestoreFailed) return localCol.get();
        try {
          return await fsCol.get();
        } catch (err) {
          switchToLocal(err);
          return await localCol.get();
        }
      },

      where(field, op, val) {
        if (firestoreFailed) return localCol.where(field, op, val);
        const fsQuery = fsCol.where(field, op, val);
        const localQuery = localCol.where(field, op, val);

        return {
          limit(count) {
            if (firestoreFailed) return localQuery.limit(count);
            const fsLimited = fsQuery.limit(count);
            const localLimited = localQuery.limit(count);

            return {
              async get() {
                if (firestoreFailed) return localLimited.get();
                try {
                  return await fsLimited.get();
                } catch (err) {
                  switchToLocal(err);
                  return await localLimited.get();
                }
              }
            };
          },
          async get() {
            if (firestoreFailed) return localQuery.get();
            try {
              return await fsQuery.get();
            } catch (err) {
              switchToLocal(err);
              return await localQuery.get();
            }
          }
        };
      },

      orderBy(field, direction = "asc") {
        if (firestoreFailed) return localCol.orderBy(field, direction);
        const fsQuery = fsCol.orderBy(field, direction);
        const localQuery = localCol.orderBy(field, direction);

        return {
          limit(count) {
            if (firestoreFailed) return localQuery.limit(count);
            const fsLimited = fsQuery.limit(count);
            const localLimited = localQuery.limit(count);

            return {
              async get() {
                if (firestoreFailed) return localLimited.get();
                try {
                  return await fsLimited.get();
                } catch (err) {
                  switchToLocal(err);
                  return await localLimited.get();
                }
              }
            };
          },
          async get() {
            if (firestoreFailed) return localQuery.get();
            try {
              return await fsQuery.get();
            } catch (err) {
              switchToLocal(err);
              return await localQuery.get();
            }
          }
        };
      }
    };
  },

  batch() {
    if (firestoreFailed || !firestoreInstance) {
      return localDb.batch();
    }
    const fsBatch = firestoreInstance.batch();
    const ops = [];

    return {
      set(ref, data, options) {
        ops.push({ type: "set", ref, data, options });
        try {
          if (!firestoreFailed) {
            const fsRef = firestoreInstance.collection(ref.collectionName || ref.parent?.id).doc(ref.id);
            fsBatch.set(fsRef, data, options);
          }
        } catch {
          // ignore until commit
        }
        return this;
      },
      delete(ref) {
        ops.push({ type: "delete", ref });
        try {
          if (!firestoreFailed) {
            const fsRef = firestoreInstance.collection(ref.collectionName || ref.parent?.id).doc(ref.id);
            fsBatch.delete(fsRef);
          }
        } catch {
          // ignore until commit
        }
        return this;
      },
      async commit() {
        if (!firestoreFailed) {
          try {
            return await fsBatch.commit();
          } catch (err) {
            switchToLocal(err);
          }
        }
        const localBatch = localDb.batch();
        for (const op of ops) {
          const col = op.ref.collectionName || op.ref.parent?.id;
          const localRef = localDb.collection(col).doc(op.ref.id);
          if (op.type === "set") localBatch.set(localRef, op.data, op.options);
          if (op.type === "delete") localBatch.delete(localRef);
        }
        return await localBatch.commit();
      }
    };
  },

  async runTransaction(updateFn) {
    if (firestoreFailed || !firestoreInstance) {
      return await localDb.runTransaction(updateFn);
    }
    try {
      return await firestoreInstance.runTransaction(async (fsTx) => {
        const txWrapper = {
          async get(ref) {
            const fsRef = firestoreInstance.collection(ref.collectionName || ref.parent?.id).doc(ref.id);
            return await fsTx.get(fsRef);
          },
          set(ref, data, options) {
            const fsRef = firestoreInstance.collection(ref.collectionName || ref.parent?.id).doc(ref.id);
            fsTx.set(fsRef, data, options);
            return this;
          },
          delete(ref) {
            const fsRef = firestoreInstance.collection(ref.collectionName || ref.parent?.id).doc(ref.id);
            fsTx.delete(fsRef);
            return this;
          }
        };
        return await updateFn(txWrapper);
      });
    } catch (err) {
      switchToLocal(err);
      return await localDb.runTransaction(updateFn);
    }
  }
};

export const adminAuth = {
  async createCustomToken(uid, claims) {
    if (firestoreFailed || !authInstance) return null;
    try {
      return await authInstance.createCustomToken(uid, claims);
    } catch (err) {
      console.warn("[Firebase] createCustomToken không khả dụng:", err.message);
      return null;
    }
  }
};
