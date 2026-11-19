const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'letters.json');
const MAX_BODY_BYTES = 35 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_TOTAL_FILE_SIZE = 20 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]\n', 'utf8');

const PUBLIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' }
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readLetters() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('خواندن data/letters.json ناموفق بود:', error.message);
    throw new Error('فایل ذخیره‌سازی پیام‌ها قابل خواندن نیست.');
  }
}

function writeLetters(letters) {
  const temporaryFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(letters, null, 2), 'utf8');
  fs.renameSync(temporaryFile, DB_FILE);
}

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('حجم درخواست بیش از حد مجاز است. مجموع فایل‌ها نباید از ۲۰ مگابایت بیشتر شود.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    const error = new Error('داده ارسالی معتبر نیست.');
    error.statusCode = 400;
    throw error;
  }
}

function publicLetter(letter, includeFiles = false) {
  const result = { ...letter };
  result.attachments = (letter.attachments || []).map((file) => {
    if (includeFiles) return file;
    const { dataBase64, ...metadata } = file;
    return metadata;
  });
  return result;
}

function validateLetter(letter) {
  if (!letter || typeof letter !== 'object') return 'ساختار پیام معتبر نیست.';
  if (!String(letter.message || '').trim()) return 'متن پیام خالی است.';
  if (!String(letter.id || '').trim()) return 'شناسه پیام ارسال نشده است.';
  if (!Array.isArray(letter.attachments)) return 'ساختار فایل‌های پیوست معتبر نیست.';
  if (letter.attachments.length > MAX_FILES) return `حداکثر ${MAX_FILES} فایل مجاز است.`;

  let totalSize = 0;
  for (const file of letter.attachments) {
    if (!file || typeof file.dataBase64 !== 'string') return 'محتوای یکی از پیوست‌ها معتبر نیست.';
    const size = Number(file.size) || 0;
    if (size > MAX_FILE_SIZE) return 'هر فایل باید حداکثر ۸ مگابایت باشد.';
    totalSize += size;
  }
  if (totalSize > MAX_TOTAL_FILE_SIZE) return 'حجم مجموع فایل‌ها نباید بیشتر از ۲۰ مگابایت باشد.';
  return null;
}

function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/letters' && req.method === 'GET') {
    try {
      const letters = readLetters()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((letter) => publicLetter(letter, false));
      return sendJson(res, 200, letters);
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (pathname === '/api/letters' && req.method === 'POST') {
    readRequestBody(req).then((letter) => {
      const validationError = validateLetter(letter);
      if (validationError) return sendJson(res, 400, { error: validationError });
      try {
        const letters = readLetters();
        if (letters.some((item) => item.id === letter.id)) {
          return sendJson(res, 409, { error: 'این پیام قبلاً ثبت شده است.' });
        }
        const normalized = {
          id: String(letter.id),
          sender: String(letter.sender || 'ناشناس'),
          subject: String(letter.subject || 'بدون عنوان'),
          message: String(letter.message),
          createdAt: letter.createdAt || new Date().toISOString(),
          attachments: letter.attachments.map((file) => ({
            name: String(file.name || 'attachment'),
            type: String(file.type || 'application/octet-stream'),
            size: Number(file.size) || 0,
            dataBase64: file.dataBase64
          }))
        };
        letters.push(normalized);
        writeLetters(letters);
        return sendJson(res, 201, { ok: true, id: normalized.id });
      } catch (error) {
        console.error(error);
        return sendJson(res, 500, { error: error.message || 'ذخیره پیام انجام نشد.' });
      }
    }).catch((error) => {
      if (!res.headersSent) sendJson(res, error.statusCode || 400, { error: error.message || 'خواندن درخواست ناموفق بود.' });
    });
    return;
  }

  const match = pathname.match(/^\/api\/letters\/([^/]+)$/);
  if (match && req.method === 'GET') {
    let id;
    try { id = decodeURIComponent(match[1]); } catch (_) { return sendJson(res, 400, { error: 'شناسه نامعتبر است.' }); }
    try {
      const letter = readLetters().find((item) => item.id === id);
      if (!letter) return sendJson(res, 404, { error: 'این پیام پیدا نشد.' });
      return sendJson(res, 200, publicLetter(letter, true));
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (match && req.method === 'DELETE') {
    let id;
    try { id = decodeURIComponent(match[1]); } catch (_) { return sendJson(res, 400, { error: 'شناسه نامعتبر است.' }); }
    try {
      const letters = readLetters();
      const filtered = letters.filter((item) => item.id !== id);
      if (filtered.length === letters.length) return sendJson(res, 404, { error: 'این پیام پیدا نشد.' });
      writeLetters(filtered);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: 'مسیر API پیدا نشد.' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  const publicFile = PUBLIC_FILES[url.pathname];
  if (!publicFile || req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 - Not Found');
  }

  const fullPath = path.join(ROOT, publicFile.file);
  fs.readFile(fullPath, (error, content) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('خطا در خواندن فایل سایت.');
    }
    res.writeHead(200, {
      'Content-Type': publicFile.type,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache'
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
});

server.listen(PORT, HOST, () => {
  console.log('\nسامانه صدای دانش‌آموز اجرا شد.');
  console.log(`روی همین دستگاه: http://localhost:${PORT}`);
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const info of entries || []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address);
    }
  }
  if (addresses.length) {
    console.log('\nبرای دستگاه‌های دیگر در همان شبکه، یکی از این آدرس‌ها را باز کنید:');
    for (const address of [...new Set(addresses)]) console.log(`  http://${address}:${PORT}`);
  }
  console.log('\nبرای خاموش کردن سرور، همین پنجره را ببندید یا Ctrl+C بزنید.\n');
});
