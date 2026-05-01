import { useEffect, useState } from 'react';

const STORAGE_KEY = 'aurora_theme';
const THEMES = ['dark', 'light'];

function readPersistedTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (THEMES.includes(t)) return t;
  } catch {}
  return 'dark';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  // Sync the PWA status-bar color so iOS / Android chrome matches.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f7fa' : '#0d1a26');
}

/**
 * useTheme — reads/writes the global UI theme. The initial theme is applied
 * pre-paint by an inline script in index.html (avoids flash-of-wrong-theme),
 * so this hook just keeps React state in sync and persists changes.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(readPersistedTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const setTheme = (next) => {
    if (THEMES.includes(next)) setThemeState(next);
  };
  const toggleTheme = () => setThemeState(t => (t === 'light' ? 'dark' : 'light'));

  return { theme, setTheme, toggleTheme };
}
