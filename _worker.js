/**
 * CLOUDFLARE PAGES / WORKER ENTRY
 */
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwetSgXYlfCuKE7wj7WtryWxhB-MADsZ5rj_3wpUpbeoX6vw9zpgmma3EmRHc9i4TZe/exec';

export default {
  async fetch(request, env, ctx) {
    const scriptUrl = (env && env.GOOGLE_SCRIPT_URL) || GOOGLE_SCRIPT_URL;

    const url = new URL(request.url);
    const targetUrl = new URL(scriptUrl);

    url.searchParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value);
    });

    const init = {
      method: request.method,
      headers: {
        'Accept': request.headers.get('Accept') || '*/*',
        'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
      },
      redirect: 'follow'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      const contentType = request.headers.get('content-type');
      if (contentType) init.headers['Content-Type'] = contentType;
    }

    try {
      const response = await fetch(targetUrl.toString(), init);

      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      newHeaders.delete('X-Frame-Options');
      newHeaders.delete('Content-Security-Policy');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    } catch (err) {
      return new Response(`Proxy Error: ${err.message}`, { status: 500 });
    }
  }
};
