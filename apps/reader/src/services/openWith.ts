import type { BookRecord } from '@hamesh/storage';
import { useLibraryStore } from '../stores/libraryStore';
import { isTauriRuntime } from './dataStore';
import { importBookFile } from './importBook';
import { persistBook } from './libraryPersistence';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
};

/**
 * Desktop open-with: when the app is launched with an EPUB path, import it
 * before rendering. No-op on web.
 */
export const importInitialFile = async (): Promise<BookRecord | null> => {
  if (!isTauriRuntime()) return null;

  const { invoke } = await import('@tauri-apps/api/core');
  const path = await invoke<string | null>('initial_book_path');
  if (!path) return null;

  const bytes = await invoke<number[]>('read_external_file', { path });
  const name = path.split(/[\\/]/).pop() ?? 'book.epub';
  const isPdf = name.toLowerCase().endsWith('.pdf');
  const file = new File([toArrayBuffer(Uint8Array.from(bytes))], name, {
    type: isPdf ? 'application/pdf' : 'application/epub+zip',
  });

  const imported = await importBookFile(file);
  useLibraryStore.getState().addBook(imported.record);
  await persistBook(imported.record, imported.file, imported.cover);
  return imported.record;
};
