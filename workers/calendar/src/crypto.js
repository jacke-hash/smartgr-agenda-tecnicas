async function deriveKeyBytes(secret) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
}

function bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function encryptSecret(plainText, secret) {
  const keyBytes = await deriveKeyBytes(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainText));
  return `${bufToBase64(iv)}:${bufToBase64(cipherBuf)}`;
}

export async function decryptSecret(encoded, secret) {
  const [ivB64, cipherB64] = encoded.split(':');
  const iv = base64ToBuf(ivB64);
  const cipherBuf = base64ToBuf(cipherB64);
  const keyBytes = await deriveKeyBytes(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, cipherBuf);
  return new TextDecoder().decode(plainBuf);
}

export async function signState(payloadObj, secret) {
  const payload = btoa(JSON.stringify(payloadObj));
  const keyBytes = await deriveKeyBytes(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${bufToBase64(sigBuf)}`;
}

export async function verifyState(token, secret, maxAgeMs) {
  const [payload, sig] = (token || '').split('.');
  if (!payload || !sig) return null;

  const keyBytes = await deriveKeyBytes(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, base64ToBuf(sig), new TextEncoder().encode(payload));
  if (!valid) return null;

  let data;
  try {
    data = JSON.parse(atob(payload));
  } catch {
    return null;
  }
  if (typeof data.ts !== 'number' || Date.now() - data.ts > maxAgeMs) return null;
  return data;
}
