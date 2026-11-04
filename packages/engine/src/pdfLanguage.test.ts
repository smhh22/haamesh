import { describe, expect, it } from 'vitest';
import { profilePdfText } from './pdfLanguage';

describe('profilePdfText', () => {
  it('detects Persian text with RTL direction', () => {
    const sample = 'این متن نمونه است. کتاب‌های فارسی با حروف گ چ پ ژ نوشته می‌شوند.';
    expect(profilePdfText(sample)).toEqual({ language: 'fa', direction: 'rtl' });
  });

  it('detects Arabic text that has no Persian letters', () => {
    const sample = 'هذا نص عربي لا يحتوي على أحرف فارسية على الإطلاق';
    expect(profilePdfText(sample)).toEqual({ language: 'ar', direction: 'rtl' });
  });

  it('detects Hebrew as RTL', () => {
    expect(profilePdfText('זהו טקסט לדוגמה בעברית')).toEqual({ language: 'he', direction: 'rtl' });
  });

  it('detects Urdu by its own letters before Persian ones', () => {
    // Contains ٹ and ے (Urdu-only) alongside گ (shared with Persian).
    expect(profilePdfText('یہ اردو متن ہے جس میں ٹ اور ے شامل ہیں')).toEqual({
      language: 'ur',
      direction: 'rtl',
    });
  });

  it('detects Japanese kana over the shared Han script', () => {
    expect(profilePdfText('これは日本語のサンプルテキストです。漢字も含む。')).toEqual({
      language: 'ja',
      direction: 'ltr',
    });
  });

  it('detects Chinese from Han text without kana', () => {
    expect(profilePdfText('这是一段中文示例文本，用于语言检测。')).toEqual({
      language: 'zh',
      direction: 'ltr',
    });
  });

  it('detects Korean Hangul', () => {
    expect(profilePdfText('이것은 한국어 샘플 텍스트입니다')).toEqual({
      language: 'ko',
      direction: 'ltr',
    });
  });

  it('stays unknown for Latin text instead of guessing a language', () => {
    expect(profilePdfText('This is an English sample with some 1234 numbers.')).toEqual({
      language: null,
      direction: 'ltr',
    });
  });

  it('stays unknown for Cyrillic text', () => {
    expect(profilePdfText('Это пример текста на русском или другом языке')).toEqual({
      language: null,
      direction: 'ltr',
    });
  });

  it('stays unknown when the sample has no letters at all', () => {
    expect(profilePdfText('1234 - 5678 ... 90% #')).toEqual({ language: null, direction: 'ltr' });
    expect(profilePdfText('')).toEqual({ language: null, direction: 'ltr' });
  });

  it('picks the dominant script in a mixed sample', () => {
    // Mostly Persian with a small English header.
    const sample =
      'Contents فهرست مطالب — فصل اول: آغاز داستان، دربارهٔ کتاب‌ها و کتابخوان‌ها و چیزهای دیگر';
    expect(profilePdfText(sample)).toEqual({ language: 'fa', direction: 'rtl' });
  });
});
