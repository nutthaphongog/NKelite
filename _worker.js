/**
 * ACADEMY ROSTER - CLOUDFLARE WORKER & PAGES PROXY
 * ================================================
 * พัฒนาตามโครงสร้าง BoOnSong663.github.io:
 * 1. ดึงหน้า HTML จาก GitHub Repo (หรือเสิร์ฟตรง) แบบมี Cloudflare Edge Cache
 * 2. Proxy คำขอ API ผ่าน /api/gas ไปยัง Google Apps Script
 * 3. หมดปัญหา iframe / จอขาว / iOS Safari Sandbox 100%
 */

// ==================== การตั้งค่า ====================
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbye-Y6fXI5STtReHVMr5r0k48xkNZxk0T5XRvbztlPsU_O0hS6ie0JMAsBtc5BbcYAS/exec";

// GitHub Repo ของคุณ (เปลี่ยนได้ตามต้องการ)
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/nutthaphongog/NKelite/main";

const CACHEABLE_ACTIONS = new Set(['getAllData']);
const CACHE_TTL_SECONDS = 30; // แคชข้อมูล 30 วินาที

// การล้างแคชเมื่อมีการแก้ไขข้อมูล
const CACHE_INVALIDATION_MAP = {
  'addStudent': ['getAllData'],
  'updateStudent': ['getAllData'],
  'deleteStudent': ['getAllData'],
  'toggleAttendance': ['getAllData'],
  'toggleSessionPayment': ['getAllData'],
  'toggleMonthlyPayment': ['getAllData']
};

// ==================== Worker หลัก ====================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. จัดการคำขอ API -> Google Apps Script
    if (url.pathname === '/api/gas' && request.method === 'POST') {
      return handleGasProxy(request, env, ctx);
    }

    // 2. ถ้าเป็น Cloudflare Pages ให้เสิร์ฟไฟล์ใน Repo โดยตรง (รองรับทั้ง Private และ Public Repo)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // 3. จัดการเส้นทางหน้าเว็บ (Routing สำหรับ GitHub Raw Fallback)
    let path = url.pathname;
    if (path === '/' || path === '/index' || path === '/index.html' || path === '/roster') {
      path = '/index.html';
    }

    // 4. ดึงไฟล์ HTML จาก GitHub พร้อม Cloudflare Edge Caching (สำหรับ Public Repo)
    const githubUrl = `${GITHUB_RAW_BASE}${path}`;
    let res = await fetch(githubUrl, {
      cf: {
        cacheTtl: 60,
        cacheEverything: true
      }
    });

    if (!res.ok) {
      return new Response(`ไม่พบหน้านี้ (404 Not Found): ${path} — หาก Repo เป็น Private โปรดเปลี่ยนเป็น Public ใน Settings ของ GitHub หรือให้ Cloudflare Pages อ่านผ่าน env.ASSETS`, {
        status: 404,
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    const html = await res.text();
    return new Response(html, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        "cache-control": "public, max-age=30, s-maxage=60",
      },
    });
  }
};

// ==================== Proxy ส่งคำขอไปยัง Google Apps Script ====================
async function handleGasProxy(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: 'invalid json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const gasUrl = (env && env.GOOGLE_SCRIPT_URL) || GAS_API_URL;
  const isCacheable = CACHEABLE_ACTIONS.has(body.action);
  const cache = caches.default;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.set('action', body.action);
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  if (isCacheable) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let gasRes;

  try {
    // ส่ง POST ไปยัง Google Apps Script (ใช้ redirect manual เพื่อจัดการ 302 ด้วย GET)
    gasRes = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: controller.signal
    });

    // ถ้า Google ตอบกลับ 302 ให้ดึงข้อมูลผ่าน GET จาก Location
    if (gasRes.status >= 300 && gasRes.status < 400) {
      const redirectLocation = gasRes.headers.get('location');
      if (redirectLocation) {
        gasRes = await fetch(redirectLocation, {
          method: 'GET',
          signal: controller.signal
        });
      }
    }
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return new Response(JSON.stringify({
      success: false,
      error: isTimeout
        ? 'เชื่อมต่อฐานข้อมูล Google Apps Script ไม่สำเร็จ (Timeout)'
        : 'ไม่สามารถติดต่อ Google Apps Script ได้: ' + err.message
    }), {
      status: 502,
      headers: { 'content-type': 'application/json' }
    });
  }
  clearTimeout(timer);

  const text = await gasRes.text();
  const response = new Response(text, {
    status: gasRes.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': isCacheable ? `public, max-age=${CACHE_TTL_SECONDS}` : 'no-store',
      'access-control-allow-origin': '*'
    }
  });

  if (isCacheable && gasRes.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  // ล้างแคชเมื่อมีการแก้ไขข้อมูล
  const actionsToInvalidate = CACHE_INVALIDATION_MAP[body.action];
  if (actionsToInvalidate && gasRes.ok) {
    ctx.waitUntil((async () => {
      for (const actionName of actionsToInvalidate) {
        const invalidateUrl = new URL(request.url);
        invalidateUrl.searchParams.set('action', actionName);
        const invalidateKey = new Request(invalidateUrl.toString(), { method: 'GET' });
        await cache.delete(invalidateKey);
      }
    })());
  }

  return response;
}
