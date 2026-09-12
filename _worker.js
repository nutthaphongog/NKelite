/**
 * CLOUDFLARE WORKER PROXY FOR GOOGLE APPS SCRIPT WEB APP
 * =======================================================
 * สคริปต์นี้ใช้สำหรับนำไปวางใน Cloudflare Workers เพื่อทำเป็น Custom Domain / Proxy 
 * ช่วยแก้ปัญหาบน iOS Safari / iOS Web App (PWA) เช่น:
 * 1. ไม่ติด Google Top Bar / Google iframe banner
 * 2. รองรับ "Add to Home Screen" บน iPhone / iPad เต็มหน้าจอ (Standalone Mode)
 * 3. แก้ปัญหา 302 Redirect และ Cross-Origin / Cookies บน Safari
 * 4. โหลดเร็วขึ้นด้วย Cloudflare Edge Caching & CDN
 */

// ใส่ URL Web App ของคุณที่ได้จาก Google Apps Script (ลงท้ายด้วย /exec)
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwetSgXYlfCuKE7wj7WtryWxhB-MADsZ5rj_3wpUpbeoX6vw9zpgmma3EmRHc9i4TZe/exec';

export default {
  async fetch(request, env, ctx) {
    const scriptUrl = env.GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL;

    // ตรวจสอบว่ามีการใส่ URL แล้วหรือยัง
    if (!scriptUrl || scriptUrl.includes('AKfycb...')) {
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Academy Roster - Setup</title></head>
        <body style="font-family:sans-serif;padding:30px;line-height:1.6;color:#333;">
          <h2>⚙️ ยังไม่ได้ระบุ Google Apps Script Web App URL</h2>
          <p>กรุณาเปิดไฟล์ Worker หรือเข้าไปที่หน้า <b>Settings > Variables</b> ใน Cloudflare Worker แล้วเพิ่ม Environment Variable:</p>
          <pre style="background:#f4f4f4;padding:12px;border-radius:6px;">GOOGLE_SCRIPT_URL = https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec</pre>
        </body>
        </html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 200 }
      );
    }

    const url = new URL(request.url);
    const targetUrl = new URL(scriptUrl);

    // ส่ง query parameters ต่อไปยัง Google Apps Script
    url.searchParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value);
    });

    // สร้าง Request ส่งต่อไปยัง Google Apps Script
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

      // สร้าง Response Header ใหม่ เพื่อลบข้อจำกัด Framing และรองรับ iOS
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
