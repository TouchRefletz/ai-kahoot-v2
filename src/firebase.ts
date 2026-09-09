import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Test connection on boot as recommended by Firebase guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firestore connection check: client is operating in offline mode.");
    }
  }
}
testConnection();

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error: any) {
    console.error('Error signing in with Google', error);
    if (error.code === 'auth/unauthorized-domain') {
      alert('Erro: Domínio não autorizado. O dono do jogo precisa adicionar este site (ex: github.io) na lista de domínios autorizados no painel do Firebase Authentication.');
    } else {
      alert('Erro ao fazer login com Google: ' + error.message);
    }
  }
};

export const signInAnon = async () => {
  try {
    await signInAnonymously(auth);
  } catch (error: any) {
    console.error('Error signing in anonymously', error);
    if (error.code === 'auth/operation-not-allowed') {
      alert('Erro: Login Anônimo não está ativado no Firebase. O dono do jogo precisa ativar o provedor "Anônimo" no painel do Firebase Authentication.');
    } else if (error.code === 'auth/unauthorized-domain') {
      alert('Erro: Domínio não autorizado. O dono do jogo precisa adicionar este site (ex: github.io) na lista de domínios autorizados no painel do Firebase Authentication.');
    } else {
      alert('Erro ao entrar no jogo: ' + error.message);
    }
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error signing out', error);
  }
};
