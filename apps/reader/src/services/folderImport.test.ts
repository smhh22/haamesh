import { describe, expect, it } from 'vitest';
import { FolderImportError, MAX_FOLDER_IMPORT_FILES, planFolderImport } from './folderImport';

const file = (path: string, bytes = 'x'): File => {
  const name = path.split('/').pop() ?? path;
  const entry = new File([bytes], name);
  Object.defineProperty(entry, 'webkitRelativePath', { value: path });
  return entry;
};

describe('planFolderImport', () => {
  it('mirrors the folder tree into groups, parents before children', () => {
    const plan = planFolderImport([
      file('CS224W/slides/01.pdf'),
      file('CS224W/slides/02.pdf'),
      file('CS224W/homework/hw1.pdf'),
      file('CS224W/syllabus.pdf'),
      file('CS224W/readings/week1/paper.pdf'),
    ]);

    expect(plan.groups.map((group) => [group.path, group.parentPath])).toEqual([
      ['CS224W', null],
      ['CS224W/homework', 'CS224W'],
      ['CS224W/readings', 'CS224W'],
      ['CS224W/slides', 'CS224W'],
      ['CS224W/readings/week1', 'CS224W/readings'],
    ]);
    expect(plan.groups.find((group) => group.path === 'CS224W')?.files).toHaveLength(1);
    expect(plan.groups.find((group) => group.path === 'CS224W/slides')?.files).toHaveLength(2);
    expect(plan.total).toBe(5);
    expect(plan.skipped).toBe(0);
    expect(plan.rootFiles).toEqual([]);
  });

  it('files a flat multi-select without relative paths as root files', () => {
    const flat = [new File(['x'], 'a.epub'), new File(['x'], 'b.pdf')];
    const plan = planFolderImport(flat);
    expect(plan.groups).toEqual([]);
    expect(plan.rootFiles).toHaveLength(2);
    expect(plan.total).toBe(2);
  });

  it('skips hidden entries and unsupported files, counting them', () => {
    const plan = planFolderImport([
      file('Course/notes.pdf'),
      file('Course/video.mp4'),
      file('Course/handout.docx'),
      file('Course/.DS_Store'),
      file('Course/.hidden/secret.pdf'),
      file('Course/archive.zip'),
    ]);
    expect(plan.total).toBe(2);
    expect(plan.skipped).toBe(4);
    expect(plan.groups.map((group) => group.path)).toEqual(['Course']);
  });

  it('drops folders that end up empty after filtering', () => {
    const plan = planFolderImport([
      file('Course/real.pdf'),
      file('Course/emptya/notes.txt'),
      file('Course/emptya/emptyb/notes.txt'),
    ]);
    expect(plan.groups.map((group) => group.path)).toEqual(['Course']);
    expect(plan.skipped).toBe(2);
  });

  it('throws EMPTY when nothing importable was picked', () => {
    expect(() => planFolderImport([file('Course/notes.txt')])).toThrow(FolderImportError);
    try {
      planFolderImport([file('Course/notes.txt')]);
    } catch (error) {
      expect((error as FolderImportError).code).toBe('EMPTY');
    }
  });

  it('throws TOO_MANY above the file cap', () => {
    const files = Array.from({ length: MAX_FOLDER_IMPORT_FILES + 1 }, (_, index) =>
      file(`Course/${index}.pdf`, `${index}`),
    );
    expect(() => planFolderImport(files)).toThrow(FolderImportError);
    try {
      planFolderImport(files);
    } catch (error) {
      expect((error as FolderImportError).code).toBe('TOO_MANY');
    }
  });

  it('accepts the cap exactly', () => {
    const files = Array.from({ length: MAX_FOLDER_IMPORT_FILES }, (_, index) =>
      file(`Course/${index}.pdf`, `${index}`),
    );
    const plan = planFolderImport(files);
    expect(plan.total).toBe(MAX_FOLDER_IMPORT_FILES);
  });
});
