import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles/index.css';
import { App } from './app/App';

// A tab left open across a new version asks for files that no longer exist.
// Reload once to pick up the new ones (index.html handles the first load).
window.addEventListener('vite:preloadError', (event) => {
  const key = 'vio.assetReload';
  try {
    if (Date.now() - Number(sessionStorage.getItem(key)) < 10_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
