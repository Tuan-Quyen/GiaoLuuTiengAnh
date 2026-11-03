import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const DATA_DIR = process.env.DATA_DIR ?? resolve(ROOT, 'data');
export const BANK_DIR = resolve(DATA_DIR, 'bank');
export const MEDIA_DIR = resolve(DATA_DIR, 'media');
export const DB_PATH = process.env.DB_PATH ?? resolve(DATA_DIR, 'app.db');
export const CLIENT_DIST = resolve(ROOT, 'dist');
