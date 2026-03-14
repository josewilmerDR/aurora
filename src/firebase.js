import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCR-K3pQyk4MT9Bnsx1pUzdPZYg0qnMSEE",
  authDomain: "aurora-7dc9b.firebaseapp.com",
  projectId: "aurora-7dc9b",
  storageBucket: "aurora-7dc9b.firebasestorage.app",
  messagingSenderId: "103051938438",
  appId: "1:103051938438:web:93ef0b7d93f98a56031f07",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app, 'auroradatabase');

// En desarrollo local, usar los emuladores
if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
