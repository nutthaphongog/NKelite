/**
 * ACADEMY ROSTER - CLOUDFLARE WORKER & PAGES PROXY (v4)
 * =====================================================
 * 1. เสิร์ฟหน้าเว็บ (env.ASSETS ถ้ามี ไม่งั้นดึงจาก GitHub Raw พร้อม Edge Cache)
 * 2. Proxy คำขอ /api/gas ไปยัง Google Apps Script
 *
 * ต้องตั้งค่า Secret ชื่อ GOOGLE_SCRIPT_URL ใน Cloudflare (ไม่ฝัง URL ไว้ในโค้ดอีกต่อไป)
 */

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/nutthaphongog/NKelite/main";

// แคชการอ่านที่ Edge (วินาที) — รูปเปลี่ยนไม่บ่อย จึงแคชนานกว่า
const CACHE_TTL = { getAllData: 30, getPhotos: 120 };

// การเขียนข้อมูล -> ล้างแคชที่เกี่ยวข้อง
const CACHE_INVALIDATION_MAP = {
  addStudent: ['getAllData', 'getPhotos'],
  updateStudent: ['getAllData', 'getPhotos'],
  deleteStudent: ['getAllData', 'getPhotos'],
  toggleAttendance: ['getAllData'],
  toggleSessionPayment: ['getAllData'],
  toggleMonthlyPayment: ['getAllData']
};

const GAS_TIMEOUT_MS = 28000;   // ต้องมากกว่า Lock wait ใน Code.gs (10 วินาที) + เวลาทำงาน

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/gas') {
      if (request.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);
      return handleGasProxy(request, env, ctx);
    }

    // Cloudflare Pages: เสิร์ฟไฟล์ใน Repo โดยตรง (เร็วที่สุด ไม่ต้องผ่าน GitHub)
    if (env && env.ASSETS) return env.ASSETS.fetch(request);

    // Fallback: ดึงจาก GitHub Raw (Public Repo) พร้อม Edge Cache
    let path = url.pathname;
    if (path === '/' || path === '/index' || path === '/index.html' || path === '/roster') path = '/index.html';
    if (path !== '/index.html') return new Response('Not found', { status: 404 });   // กัน favicon ฯลฯ ยิงไป GitHub

    const res = await fetch(`${GITHUB_RAW_BASE}${path}`, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!res.ok) {
      return new Response(`ไม่พบหน้านี้ (404 Not Found): ${path}`, { status: 404, headers: { 'content-type': 'text/html;charset=UTF-8' } });
    }
    return new Response(await res.text(), {
      headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'public, max-age=30, s-maxage=60' }
    });
  }
};

function cacheKeyFor(request, action) {
  const u = new URL(request.url);
  u.search = '';
  u.searchParams.set('action', action);
  return new Request(u.toString(), { method: 'GET' });
}

async function handleGasProxy(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, error: 'invalid json' }, 400);
  }

  const gasUrl = env && env.GOOGLE_SCRIPT_URL;
  if (!gasUrl) return json({ success: false, error: 'ยังไม่ได้ตั้งค่า Secret GOOGLE_SCRIPT_URL ใน Cloudflare' }, 500);

  const ttl = CACHE_TTL[body.action];
  const cache = caches.default;
  const cacheKey = cacheKeyFor(request, String(body.action));

  if (ttl) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);
  let gasRes;
  try {
    // GAS ตอบ 302 ไปยังที่เก็บผลลัพธ์ -> ตาม redirect ด้วย GET (ห้ามส่ง POST ซ้ำ ไม่งั้นเขียนข้อมูลสองรอบ)
    gasRes = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: controller.signal
    });
    if (gasRes.status >= 300 && gasRes.status < 400) {
      const loc = gasRes.headers.get('location');
      if (loc) gasRes = await fetch(loc, { method: 'GET', signal: controller.signal });
    }
  } catch (err) {
    clearTimeout(timer);
    return json({
      success: false,
      error: err.name === 'AbortError'
        ? 'เชื่อมต่อ Google Apps Script ไม่สำเร็จ (Timeout) — ข้อมูลอาจถูกบันทึกแล้ว ลองรีเฟรชเพื่อตรวจสอบ'
        : 'ไม่สามารถติดต่อ Google Apps Script ได้: ' + err.message
    }, 502);
  }
  const text = await gasRes.text();
  clearTimeout(timer);

  const isErrorBody = text.startsWith('{"success":false');
  const response = new Response(text, {
    status: gasRes.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': ttl && !isErrorBody ? `public, max-age=${ttl}` : 'no-store'
    }
  });

  // แคชเฉพาะคำตอบที่สำเร็จ (ของเดิมแคชแม้ GAS ตอบ error 200 ทำให้ error ค้าง 30 วินาที)
  if (ttl && gasRes.ok && !isErrorBody) ctx.waitUntil(cache.put(cacheKey, response.clone()));

  // ล้างแคชให้เสร็จก่อนตอบกลับ (ของเดิมล้างทีหลัง ทำให้โหลดซ้ำทันทีอาจได้ข้อมูลเก่า)
  const toInvalidate = CACHE_INVALIDATION_MAP[body.action];
  if (toInvalidate && gasRes.ok) {
    await Promise.all(toInvalidate.map((a) => cache.delete(cacheKeyFor(request, a))));
  }
  return response;
}
