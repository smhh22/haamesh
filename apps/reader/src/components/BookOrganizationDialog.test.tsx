import type { BookRecord } from '@hamesh/storage';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { BookOrganizationDialog, parseTags } from './BookOrganizationDialog';

const book: BookRecord = {
  id: 'b1',
  hash: 'a'.repeat(64),
  format: 'epub',
  title: 'Original Title',
  authors: ['First Author'],
  language: 'en',
  publisher: 'Old Publisher',
  series: 'Old Series',
  identifiers: {},
  direction: 'ltr',
  category: 'Fiction',
  tags: ['tag'],
  filePath: 'books/a.epub',
  coverPath: null,
  coverMime: null,
  addedAt: 1,
  updatedAt: 1,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('parseTags', () => {
  it('splits on Latin and Persian commas, trims, and dedupes', () => {
    expect(parseTags('persian, history،  travel ,, persian')).toEqual([
      'persian',
      'history',
      'travel',
    ]);
    expect(parseTags('   ')).toEqual([]);
  });
});

describe('BookOrganizationDialog metadata editing', () => {
  it('saves edited title, authors, series, and publisher', () => {
    const onSave = vi.fn();
    render(
      <BookOrganizationDialog
        book={book}
        categories={['Fiction']}
        onSave={onSave}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  New Title  ' } });
    fireEvent.change(screen.getByLabelText('Authors'), {
      target: { value: 'Second Author، Third Author' },
    });
    fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'New Series' } });
    fireEvent.change(screen.getByLabelText('Publisher'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Title',
        authors: ['Second Author', 'Third Author'],
        series: 'New Series',
        publisher: null,
        category: 'Fiction',
      }),
    );
  });

  it('keeps the previous title when the field is emptied', () => {
    const onSave = vi.fn();
    render(
      <BookOrganizationDialog
        book={book}
        categories={['Fiction']}
        onSave={onSave}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Original Title' }));
  });
});
