/**
 * ACADEMY ROSTER - CLOUDFLARE WORKER PROXY (FULL SCREEN & iOS OPTIMIZED)
 * =======================================================================
 */
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbye-Y6fXI5STtReHVMr5r0k48xkNZxk0T5XRvbztlPsU_O0hS6ie0JMAsBtc5BbcYAS/exec';

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
        'Accept': request.headers.get('Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
      const contentType = response.headers.get('content-type') || '';

      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      newHeaders.delete('X-Frame-Options');
      newHeaders.delete('Content-Security-Policy');

      // ถ้าเป็น HTML ให้ฉีด CSS ขยาย iframe เต็มหน้าจอ 100% (แก้ปัญหากรอบสี่เหลี่ยมเล็กมุมซ้ายบน)
      if (contentType.includes('text/html')) {
        let html = await response.text();
        const injection = `
        <style id="cf-fullscreen-fix">
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
          }
          iframe, #sandboxFrame {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            height: 100dvh !important;
            border: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
          }
        </style>
        `;

        if (html.includes('</head>')) {
          html = html.replace('</head>', injection + '</head>');
        } else {
          html = injection + html;
        }

        return new Response(html, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }

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
