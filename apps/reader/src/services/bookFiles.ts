const files = new Map<string, File>();

export const rememberBookFile = (hash: string, file: File): void => {
  files.set(hash, file);
};

export const getBookFile = (hash: string): File | null => files.get(hash) ?? null;

export const forgetBookFile = (hash: string): void => {
  files.delete(hash);
};
