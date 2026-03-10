import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

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
