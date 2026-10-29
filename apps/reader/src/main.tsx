import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/700.css';
import { App } from './App';
import './i18n';
import { initLibraryPersistence } from './services/libraryPersistence';
import { importInitialFile } from './services/openWith';
import { initAutoSync } from './services/syncService';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found');
}

void (async () => {
  try {
    await initLibraryPersistence();
    await importInitialFile();
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
