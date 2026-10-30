import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/700.css';
import { App } from './App';
import './i18n';
import { initLibraryPersistence } from './services/libraryPersistence';
import { importInitialFile } from './services/openWith';
import { initAutoSync, initSyncSecurity } from './services/syncService';
import { initUiTheme } from './stores/uiStore';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found');
}

// The Android shell draws edge to edge, but its WebView reports zero safe-area
// insets, so the reader header needs a platform-level top inset.
if ('__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent)) {
  document.documentElement.dataset.platform = 'android';
}

void (async () => {
  try {
    await initLibraryPersistence();
    await importInitialFile();
    initUiTheme();
    void initSyncSecurity();
    initAutoSync();
  } catch (error) {
    console.error('Failed to load the persisted library', error);
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
})();
