import type {NextRequest} from 'next/server';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 本地入口只对通过回环地址访问的开发服务器开放。 */
export function localModeAvailable(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  const isLoopback = (value: string) => {
    try { return loopbackHosts.has(new URL(`http://${value}`).hostname); }
    catch { return false; }
  };
  return loopbackHosts.has(request.nextUrl.hostname)
    && isLoopback(request.headers.get('host') || request.nextUrl.host)
    && (!request.headers.has('x-forwarded-host') || isLoopback(request.headers.get('x-forwarded-host')!));
}
