import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth, googleProvider, ALLOWED_EMAIL_DOMAIN } from './firebase-config.js';

function isAllowedEmail(email) {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`);
}

export async function loginComGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const email = result.user?.email;

  if (!isAllowedEmail(email)) {
    await signOut(auth);
    throw new Error(`Acesso restrito a contas @${ALLOWED_EMAIL_DOMAIN}.`);
  }

  return result.user;
}

export async function logout() {
  await signOut(auth);
}

export function observarAuth(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (user && !isAllowedEmail(user.email)) {
      signOut(auth);
      callback(null);
      return;
    }
    callback(user);
  });
}

export { isAllowedEmail };
