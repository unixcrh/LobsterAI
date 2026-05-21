import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';

import {
  type FetchResponseLike,
  inferImageExtensionFromBytes,
  inferImageExtensionFromUrl,
  persistGeneratedImageAssets,
  sanitizeGeneratedImageFileName,
} from './mediaAssetPersistence';

const pngBuffer = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D,
]);

function makeResponse(buffer: Buffer, contentType: string, ok = true): FetchResponseLike {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null,
    },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

describe('mediaAssetPersistence', () => {
  test('sanitizes generated image filenames', () => {
    expect(sanitizeGeneratedImageFileName('bad:name?.png', 'generated-image', '.png')).toBe('bad-name-.png');
    expect(sanitizeGeneratedImageFileName('no-extension', 'generated-image', '.webp')).toBe('no-extension.webp');
    expect(sanitizeGeneratedImageFileName('...', 'generated-image', '.png')).toBe('generated-image.png');
  });

  test('infers image extensions from urls and bytes', () => {
    expect(inferImageExtensionFromUrl('https://example.com/path/image.png?signature=temporary')).toBe('.png');
    expect(inferImageExtensionFromBytes(pngBuffer)).toBe('.png');
  });

  test('persists downloaded images into cwd and avoids overwriting existing files', async () => {
    const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-media-assets-'));
    await fs.promises.writeFile(path.join(cwd, 'generated-image.png'), 'existing');

    const result = await persistGeneratedImageAssets({
      cwd,
      now: new Date('2026-05-14T11:50:32Z'),
      assets: [
        {
          type: 'image',
          url: 'https://example.com/generated.png?signature=temporary',
          mimeType: 'image/png',
          filename: 'generated-image.png',
        },
      ],
      fetchAsset: async () => makeResponse(pngBuffer, 'image/png'),
    });

    expect(result.failed).toHaveLength(0);
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].filename).toBe('generated-image-2.png');
    expect(result.saved[0].filePath).toBe(path.join(cwd, 'generated-image-2.png'));
    expect(await fs.promises.readFile(result.saved[0].filePath)).toEqual(pngBuffer);
  });

  test('reports failed downloads without writing files', async () => {
    const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-media-assets-'));

    const result = await persistGeneratedImageAssets({
      cwd,
      assets: [
        {
          type: 'image',
          url: 'https://example.com/generated.txt',
        },
      ],
      fetchAsset: async () => makeResponse(Buffer.from('not an image'), 'text/plain'),
    });

    expect(result.saved).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(await fs.promises.readdir(cwd)).toEqual([]);
  });
});
