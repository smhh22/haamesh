import { createTestEpub } from '@hamesh/test-fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import i18n from './i18n';
import { importBookFile } from './services/importBook';
import { useLibraryStore } from './stores/libraryStore';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useLibraryStore.setState({ books: [] });
});

describe('App', () => {
  it('starts in English and flips to Persian RTL', async () => {
    render(<App />);

    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hāmesh');
    expect(screen.getByRole('heading', { level: 2, name: 'Library' })).toHaveTextContent('Library');
    expect(screen.getByText(/no books yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /switch to persian/i }));

    await waitFor(() => {
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('fa');
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('هامش');
    expect(screen.getByRole('heading', { level: 2, name: 'کتابخانه' })).toHaveTextContent(
      'کتابخانه',
    );
  });

  it('opens the reader for an imported book', async () => {
    const file = new File([createTestEpub()], 'sample.epub', {
      type: 'application/epub+zip',
    });
    const { record } = await importBookFile(file);
    useLibraryStore.getState().addBook(record);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /read/i }));

    expect(screen.getByRole('button', { name: /library/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('نمونه کتاب');
  });
});
