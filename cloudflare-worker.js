/**
 * NotifyX Cloudflare Worker relay
 *
 * YouTube -> this Worker (HTTPS) -> NotifyX on InfinityHosting (HTTP)
 *
 * Deploy this file as the code for the Cloudflare Worker named `notifyx-relay`.
 * If your InfinityHosting hostname/port changes, update NOTIFYX_ORIGIN below.
 */

const NOTIFYX_ORIGIN = 'http://gq1.infinityhosting.online:2000';
const RELAY_PATH = '/websub/youtube';

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    if (incoming.pathname === '/' && request.method === 'GET') {
      return new Response('NotifyX relay is online.', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (incoming.pathname !== RELAY_PATH) {
      return new Response('Not found', { status: 404 });
    }

    const target = new URL(RELAY_PATH);
    target.protocol = 'http:';
    target.hostname = new URL(NOTIFYX_ORIGIN).hostname;
    target.port = new URL(NOTIFYX_ORIGIN).port;
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('content-length');

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
