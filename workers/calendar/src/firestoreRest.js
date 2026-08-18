import { getServiceAccountAccessToken } from './googleAuth.js';

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  throw new Error(`Tipo não suportado para Firestore REST: ${typeof v}`);
}

function fromFirestoreValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('doubleValue' in val) return val.doubleValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('timestampValue' in val) return val.timestampValue;
  return null;
}

function fromFirestoreFields(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields || {})) {
    out[key] = fromFirestoreValue(val);
  }
  return out;
}

function parseServiceAccount(env) {
  return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

async function getAccessToken(env) {
  return getServiceAccountAccessToken(parseServiceAccount(env), 'https://www.googleapis.com/auth/datastore');
}

function projectBaseUrl(env) {
  const serviceAccount = parseServiceAccount(env);
  return `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents`;
}

export async function getTecnica(env, id) {
  const accessToken = await getAccessToken(env);
  const resp = await fetch(`${projectBaseUrl(env)}/tecnicas/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Erro ao buscar técnica: ${resp.status} ${await resp.text()}`);
  const doc = await resp.json();
  return { id, ...fromFirestoreFields(doc.fields) };
}

export async function findTecnicaByEmail(env, email) {
  const accessToken = await getAccessToken(env);
  const serviceAccount = parseServiceAccount(env);
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'tecnicas' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'email' },
              op: 'EQUAL',
              value: { stringValue: email }
            }
          },
          limit: 1
        }
      })
    }
  );
  if (!resp.ok) throw new Error(`Erro ao buscar técnica por e-mail: ${resp.status} ${await resp.text()}`);
  const rows = await resp.json();
  const match = rows.find((r) => r.document);
  if (!match) return null;
  const id = match.document.name.split('/').pop();
  return { id, ...fromFirestoreFields(match.document.fields) };
}

export async function patchTecnica(env, id, fields) {
  const accessToken = await getAccessToken(env);
  const updateMask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const firestoreFields = {};
  for (const [k, v] of Object.entries(fields)) {
    firestoreFields[k] = toFirestoreValue(v);
  }
  const resp = await fetch(`${projectBaseUrl(env)}/tecnicas/${id}?${updateMask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: firestoreFields })
  });
  if (!resp.ok) throw new Error(`Erro ao atualizar técnica: ${resp.status} ${await resp.text()}`);
}
