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
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in val) return fromFirestoreFields(val.mapValue.fields);
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

// Sem cache, todo GET/PATCH/runQuery no Firestore (getTecnica, patchTecnica,
// listAprovadasPorTecnica...) assinava um JWT novo e batia no OAuth do
// Google do zero — inclusive várias vezes DENTRO da mesma requisição (ex:
// verificar-conflitos chama listAprovadasPorTecnica em paralelo pras 3
// coleções, cada uma pedindo seu próprio token). Isolate do Worker é
// reaproveitado entre requisições enquanto ficar "quente", então cachear em
// módulo também economiza entre chamadas diferentes, não só dentro de uma.
// Token de service account dura 1h — renova com folga de segurança.
let tokenServiceAccountCache = null;
let tokenServiceAccountExpiraEm = 0;
let tokenServiceAccountEmAndamento = null;

async function getAccessToken(env) {
  const agora = Date.now();
  if (tokenServiceAccountCache && agora < tokenServiceAccountExpiraEm) return tokenServiceAccountCache;
  if (!tokenServiceAccountEmAndamento) {
    tokenServiceAccountEmAndamento = getServiceAccountAccessToken(parseServiceAccount(env), 'https://www.googleapis.com/auth/datastore')
      .then((token) => {
        tokenServiceAccountCache = token;
        tokenServiceAccountExpiraEm = Date.now() + 55 * 60 * 1000;
        return token;
      })
      .finally(() => {
        tokenServiceAccountEmAndamento = null;
      });
  }
  return tokenServiceAccountEmAndamento;
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

// Complementar à checagem real no Calendar: solicitações já aprovadas pra
// essa técnica no Firestore, caso a criação do evento no Calendar dela
// tenha falhado silenciosamente na hora da aprovação (aprovar() mostra erro
// nesse caso pra Julia, mas o status já fica 'aprovado' mesmo assim — sem
// essa checagem, esse gap nunca apareceria em nenhuma consulta ao Calendar).
export async function listAprovadasPorTecnica(env, colecao, tecnicaId) {
  const accessToken = await getAccessToken(env);
  const serviceAccount = parseServiceAccount(env);
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: colecao }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: 'tecnicaAtribuida' }, op: 'EQUAL', value: { stringValue: tecnicaId } } },
                { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'aprovado' } } }
              ]
            }
          }
        }
      })
    }
  );
  if (!resp.ok) throw new Error(`Erro ao listar aprovadas de ${colecao} pra técnica ${tecnicaId}: ${resp.status} ${await resp.text()}`);
  const rows = await resp.json();
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...fromFirestoreFields(r.document.fields) }));
}

export async function patchDocumento(env, colecao, id, fields) {
  const accessToken = await getAccessToken(env);
  const updateMask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const firestoreFields = {};
  for (const [k, v] of Object.entries(fields)) {
    firestoreFields[k] = toFirestoreValue(v);
  }
  const resp = await fetch(`${projectBaseUrl(env)}/${colecao}/${id}?${updateMask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: firestoreFields })
  });
  if (!resp.ok) throw new Error(`Erro ao atualizar ${colecao}/${id}: ${resp.status} ${await resp.text()}`);
}

export async function patchTecnica(env, id, fields) {
  return patchDocumento(env, 'tecnicas', id, fields);
}
