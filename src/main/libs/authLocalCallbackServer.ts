import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';

const AUTH_CALLBACK_PATH = '/auth/callback';
const AUTH_LOCAL_CALLBACK_HOST = '127.0.0.1';
const AUTH_LOCAL_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

interface AuthLocalCallbackOptions {
  onCode: (code: string) => void;
  timeoutMs?: number;
}

export interface AuthLocalCallback {
  redirectUri: string;
  state: string;
  close: () => Promise<void>;
}

let activeCallback: AuthLocalCallback | null = null;

const escapeHtml = (value: string): string =>
  value.replace(/[<>&"]/g, (char) => {
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '&') return '&amp;';
    return '&quot;';
  });

const renderCallbackHtml = (success: boolean, message: string): string => {
  const color = success ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>LobsterAI 登录</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #14120b; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #fff; border: 1px solid rgba(20,18,11,.08); border-radius: 10px; padding: 30px 34px; max-width: 420px; box-shadow: 0 18px 50px rgba(20,18,11,.08); }
  h1 { color: ${color}; font-size: 20px; line-height: 1.3; margin: 0 0 10px; font-weight: 600; }
  p { color: #666; font-size: 14px; line-height: 1.6; margin: 0; }
</style></head>
<body><div class="card"><h1>${success ? '登录成功' : '登录失败'}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
};

const sendHtml = (
  res: http.ServerResponse,
  statusCode: number,
  success: boolean,
  message: string,
): void => {
  const html = renderCallbackHtml(success, message);
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
};

const closeServer = (server: http.Server): Promise<void> =>
  new Promise(resolve => {
    server.close(() => resolve());
  });

export function appendLoginParams(baseUrl: string, params: Record<string, string>): string {
  const parsed = new URL(baseUrl);

  if (parsed.hash) {
    const hash = parsed.hash.slice(1);
    const queryStart = hash.indexOf('?');
    const hashPath = queryStart >= 0 ? hash.slice(0, queryStart) : hash;
    const hashQuery = queryStart >= 0 ? hash.slice(queryStart + 1) : '';
    const hashParams = new URLSearchParams(hashQuery);
    Object.entries(params).forEach(([key, value]) => {
      hashParams.set(key, value);
    });
    const nextQuery = hashParams.toString();
    parsed.hash = nextQuery ? `${hashPath}?${nextQuery}` : hashPath;
    return parsed.toString();
  }

  Object.entries(params).forEach(([key, value]) => {
    parsed.searchParams.set(key, value);
  });
  return parsed.toString();
}

export async function startAuthLocalCallback(
  options: AuthLocalCallbackOptions,
): Promise<AuthLocalCallback> {
  if (activeCallback) {
    await activeCallback.close();
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const server = http.createServer();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const callback: AuthLocalCallback = {
    redirectUri: '',
    state,
    close: async () => {
      if (closed) return;
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (activeCallback === callback) {
        activeCallback = null;
      }
      await closeServer(server);
    },
  };

  server.on('request', (req, res) => {
    if (req.method !== 'GET') {
      sendHtml(res, 405, false, '登录回调请求方法不支持，请返回 LobsterAI 后重试。');
      return;
    }

    const reqUrl = new URL(req.url || '/', `http://${AUTH_LOCAL_CALLBACK_HOST}`);
    if (reqUrl.pathname !== AUTH_CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const code = reqUrl.searchParams.get('code')?.trim();
    const returnedState = reqUrl.searchParams.get('state')?.trim();

    if (!code) {
      sendHtml(res, 400, false, '登录回调缺少授权码，请返回 LobsterAI 后重试。');
      void callback.close();
      return;
    }

    if (returnedState !== state) {
      sendHtml(res, 400, false, '登录状态校验失败，请返回 LobsterAI 后重试。');
      void callback.close();
      return;
    }

    try {
      options.onCode(code);
      sendHtml(res, 200, true, '登录已完成，可以关闭此页面并返回 LobsterAI。');
    } catch (error) {
      console.error('[AuthLocalCallback] failed to deliver auth code:', error);
      sendHtml(res, 500, false, '登录回调处理失败，请返回 LobsterAI 后重试。');
    } finally {
      void callback.close();
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, AUTH_LOCAL_CALLBACK_HOST);
  });

  const address = server.address() as AddressInfo | null;
  if (!address?.port) {
    await callback.close();
    throw new Error('Local auth callback server did not expose a port');
  }

  callback.redirectUri = `http://${AUTH_LOCAL_CALLBACK_HOST}:${address.port}${AUTH_CALLBACK_PATH}`;
  activeCallback = callback;

  timer = setTimeout(() => {
    console.warn('[AuthLocalCallback] login callback timed out, closed local server');
    void callback.close();
  }, options.timeoutMs ?? AUTH_LOCAL_CALLBACK_TIMEOUT_MS);

  return callback;
}
