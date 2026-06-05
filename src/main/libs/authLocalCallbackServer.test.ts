import { describe, expect, test } from 'vitest';

import {
  appendLoginParams,
  startAuthLocalCallback,
} from './authLocalCallbackServer';

describe('appendLoginParams', () => {
  test('appends params inside hash route query for portal URLs', () => {
    const result = appendLoginParams(
      'https://c.youdao.com/dict/hardware/octopus/lobsterai-portal.html#/login',
      {
        source: 'electron',
        redirect_uri: 'http://127.0.0.1:43210/auth/callback',
        state: 'test-state',
      },
    );

    expect(result).toBe(
      'https://c.youdao.com/dict/hardware/octopus/lobsterai-portal.html#/login?source=electron&redirect_uri=http%3A%2F%2F127.0.0.1%3A43210%2Fauth%2Fcallback&state=test-state',
    );
  });

  test('preserves existing hash route params', () => {
    const result = appendLoginParams(
      'https://c.youdao.com/dict/hardware/octopus/lobsterai-portal.html#/login?invitationCode=ABC123',
      { source: 'electron' },
    );

    expect(result).toBe(
      'https://c.youdao.com/dict/hardware/octopus/lobsterai-portal.html#/login?invitationCode=ABC123&source=electron',
    );
  });

  test('appends params to normal URL query when there is no hash route', () => {
    const result = appendLoginParams('https://example.com/login?foo=bar', {
      source: 'electron',
    });

    expect(result).toBe('https://example.com/login?foo=bar&source=electron');
  });
});

describe('startAuthLocalCallback', () => {
  test('starts on 127.0.0.1 with a dynamic callback port', async () => {
    const callback = await startAuthLocalCallback({ onCode: () => {} });

    try {
      expect(callback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
      expect(callback.state).toHaveLength(32);
    } finally {
      await callback.close();
    }
  });

  test('delivers code when callback path and state are valid', async () => {
    const codes: string[] = [];
    const callback = await startAuthLocalCallback({
      onCode: code => codes.push(code),
    });

    const response = await fetch(`${callback.redirectUri}?code=abc123&state=${callback.state}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('登录成功');
    expect(codes).toEqual(['abc123']);
  });

  test('rejects callback when state does not match', async () => {
    const codes: string[] = [];
    const callback = await startAuthLocalCallback({
      onCode: code => codes.push(code),
    });

    const response = await fetch(`${callback.redirectUri}?code=abc123&state=wrong-state`);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('登录失败');
    expect(codes).toEqual([]);
  });

  test('returns 404 for non-callback paths', async () => {
    const callback = await startAuthLocalCallback({ onCode: () => {} });

    try {
      const response = await fetch(callback.redirectUri.replace('/auth/callback', '/other'));

      expect(response.status).toBe(404);
    } finally {
      await callback.close();
    }
  });
});
