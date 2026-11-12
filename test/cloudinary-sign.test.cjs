// 보안 감사 2026-11-12 #12 — 사진 업로드는 서버가 발급한 서명으로만 한다.
// 네트워크는 전부 가짜(fetch 대역)다. 실제 Cloudinary · 백엔드로 나가는 요청은 없다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ENV = { CLOUDINARY_CLOUD_NAME: 'fixture-cloud', CLOUDINARY_API_KEY: 'fixture-key', CLOUDINARY_API_SECRET: 'fixture-secret' };

function fakeRes() {
  return { statusCode: 0, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; }, end() { return this; } };
}

// /api/staff/me 대역 — 토큰별 응답
async function withServer(staffByToken, env, fn) {
  const prevFetch = global.fetch;
  const prevEnv = {};
  for (const k of Object.keys(ENV)) { prevEnv[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push(String(url));
    assert.match(String(url), /\/api\/staff\/me$/);
    const tok = String((opts.headers || {}).Authorization || '').replace(/^Bearer /, '');
    const me = staffByToken[tok];
    if (me === 'down') return { ok: false, status: 502, json: async () => ({}) };
    if (me === 'offline') throw new TypeError('fetch failed');
    return { ok: !!me, status: me ? 200 : 401, json: async () => me || {} };
  };
  try {
    const handler = require('../api/cloudinary-sign.js');
    return await fn(handler, calls);
  } finally {
    global.fetch = prevFetch;
    for (const k of Object.keys(ENV)) { if (prevEnv[k] == null) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  }
}

function signReq(body, token) {
  return { method: 'POST', headers: Object.assign({ origin: 'https://survey.igggstudio.com' },
    token ? { authorization: 'Bearer ' + token } : {}), body };
}

test('서명 창구: 승인 직원만, 환경변수 점검은 게이트 뒤, id 는 Firestore 자동 ID 형식만', () =>
  withServer({ ok: { status: 'approved', role: 'staff' }, wait: { status: 'pending', role: 'staff' } }, {}, async (handler) => {
    // 환경변수가 없어도 비인증 호출에는 403 만 — 설정 상태를 흘리지 않는다
    for (const tok of [null, 'wait', 'nobody']) {
      const res = fakeRes(); await handler(signReq({ id: 'abc' }, tok), res);
      assert.equal(res.statusCode, 403, String(tok));
      assert.equal(JSON.stringify(res.body).includes('CLOUDINARY'), false);
      assert.equal(res.body.signature, undefined);
    }
    const unset = fakeRes(); await handler(signReq({ id: 'abc' }, 'ok'), unset);
    assert.equal(unset.statusCode, 500);

    const get = fakeRes(); await handler({ method: 'GET', headers: {}, query: {} }, get);
    assert.equal(get.statusCode, 405);
  }));

test('서명 창구: 폴더는 서버가 reports/{id} 로 만들고, 서명이 폴더 · 형식 · 시각을 묶는다', () =>
  withServer({ ok: { status: 'approved', role: 'staff' } }, ENV, async (handler) => {
    for (const bad of ['', '../x', 'a/b', 'a b', null, 42, ['a']]) {
      const res = fakeRes(); await handler(signReq({ id: bad }, 'ok'), res);
      assert.equal(res.statusCode, 400, JSON.stringify(bad));
    }
    const res = fakeRes();
    await handler(signReq({ id: 'AbC_12-x', folder: 'elsewhere', allowed_formats: 'svg' }, 'ok'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    const b = res.body;
    assert.equal(b.cloudName, 'fixture-cloud');
    assert.equal(b.apiKey, 'fixture-key');
    assert.equal(b.folder, 'reports/AbC_12-x');
    assert.equal(b.allowedFormats, 'jpg,png,webp');
    assert.ok(Math.abs(b.timestamp - Date.now() / 1000) < 5);
    assert.equal(JSON.stringify(b).includes('fixture-secret'), false);
    const expected = crypto.createHash('sha1')
      .update(`allowed_formats=jpg,png,webp&folder=reports/AbC_12-x&timestamp=${b.timestamp}fixture-secret`)
      .digest('hex');
    assert.equal(b.signature, expected);
  }));

test('서명 창구: 백엔드 장애 · 네트워크 오류는 403 이 아니라 503(화면이 다시 시도)', () =>
  withServer({ down: 'down', offline: 'offline' }, ENV, async (handler) => {
    for (const tok of ['down', 'offline']) {
      const res = fakeRes(); await handler(signReq({ id: 'abc' }, tok), res);
      assert.equal(res.statusCode, 503, tok);
      assert.equal(res.body.signature, undefined);
    }
  }));

test('서명 발급 503 이면 화면이 재시도해 결국 올린다', async () => {
  let signCalls = 0;
  const { net: base, log } = network();
  const net = async (url, init) => {
    if (String(url) === '/api/cloudinary-sign' && ++signCalls === 1) return { ok: false, status: 503, json: async () => ({}) };
    return base(url, init);
  };
  const run = app(net);
  const out = await run(`uploadPhotoSettled('data:image/webp;base64,A','rep5',0)`);
  assert.match(out, /^https:\/\/res\.test\.invalid\//);
  assert.equal(signCalls, 2);
  assert.equal(log.uploads.length, 1);
});

test('signParams 는 Cloudinary 문서 예시와 같은 값을 낸다', () => {
  const { signParams } = require('../api/cloudinary-sign.js');
  // https://cloudinary.com/documentation/authentication_signatures 예시(secret abcd)
  assert.equal(signParams({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd'),
    'bfd09f95f331f558cbd1320e67aa8d488770583e');
});

test('삭제 창구도 같은 직원 게이트를 쓴다(비인증 403)', () =>
  withServer({}, ENV, async () => {
    const del = require('../api/cloudinary-delete.js');
    const res = fakeRes(); await del({ method: 'POST', headers: {}, body: { id: 'abc' }, query: {} }, res);
    assert.equal(res.statusCode, 403);
  }));

// ── 화면: 실제 index.html 스크립트를 vm 에서 돌리고 네트워크만 바꾼다 ──
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function app(net) {
  const ctx = vm.createContext({ URLSearchParams, console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, setInterval() {}, FormData, AbortController, Promise,
    location: { pathname: '/', search: '', origin: 'https://test.invalid' },
    history: { pushState() {}, replaceState() {} },
    document: { cookie: 'iggg_sso=' + encodeURIComponent(JSON.stringify({ email: 'x@test.invalid', refreshToken: 'rt' })),
      getElementById() {}, querySelector() { return null; },
      createElement() { return { toDataURL() { return ''; } }; }, addEventListener() {} },
    window: { matchMedia() { return { matches: false, addEventListener() {} }; }, addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: net });
  vm.runInContext(source.replace(/\nrender\(\);\s*$/, '\n'), ctx);
  vm.runInContext('render = function() {}; refreshSaveBtn = function() {};', ctx);
  return (code) => vm.runInContext(code, ctx);
}

function network(opts = {}) {
  const log = { sign: 0, uploads: [] };
  let n = 0;
  const net = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://securetoken.googleapis.com/')) {
      return { ok: true, status: 200, json: async () => ({ id_token: 'idt', expires_in: '3600' }) };
    }
    if (url === '/api/cloudinary-sign') {
      log.sign++;
      assert.equal(init.headers.Authorization, 'Bearer idt');
      if (opts.signStatus) return { ok: false, status: opts.signStatus, json: async () => ({}) };
      const id = JSON.parse(init.body).id;
      return { ok: true, status: 200, json: async () => ({ cloudName: 'fixture-cloud', apiKey: 'k', folder: 'reports/' + id,
        allowedFormats: 'jpg,png,webp', timestamp: 1700000000 + log.sign, signature: 'sig' + log.sign }) };
    }
    if (url.startsWith('https://api.cloudinary.com/')) {
      const f = init.body;
      const entry = { url, fields: Object.fromEntries([...f.keys()].map((k) => [k, f.get(k)])) };
      log.uploads.push(entry);
      if (opts.rejectFirstAs && log.uploads.length === 1) {
        return { ok: false, status: opts.rejectFirstAs, text: async () => '{"error":{"message":"Invalid Signature"}}' };
      }
      n++;
      return { ok: true, status: 200, json: async () => ({ secure_url: 'https://res.test.invalid/' + entry.fields.file.slice(-1) + '-' + n }) };
    }
    throw new Error('unexpected fetch ' + url);
  };
  return { net, log };
}

test('여러 장 올리기: 서명은 보고서당 한 번, 각 장이 서명 값으로 올라가고 순서가 유지된다', async () => {
  const { net, log } = network();
  const run = app(net);
  const urls = await run(`Promise.all(['data:image/webp;base64,A','data:image/webp;base64,B','data:image/png;base64,C']
    .map((d,i)=>uploadPhotoSettled(d,'rep1',i)))`);
  assert.equal(log.sign, 1);
  assert.equal(log.uploads.length, 3);
  for (const u of log.uploads) {
    assert.equal(u.url, 'https://api.cloudinary.com/v1_1/fixture-cloud/image/upload');
    assert.equal(u.fields.signature, 'sig1');
    assert.equal(u.fields.api_key, 'k');
    assert.equal(u.fields.timestamp, '1700000001');
    assert.equal(u.fields.folder, 'reports/rep1');
    assert.equal(u.fields.allowed_formats, 'jpg,png,webp');
    assert.equal('upload_preset' in u.fields, false);
  }
  assert.deepEqual([...urls].map((u) => u.split('/').pop()[0]), ['A', 'B', 'C']);
  assert.equal(run('uploadFailed'), 0);
});

test('서명 발급이 거절되면 Cloudinary 로 보내지 않고 원본을 남긴다(본문 저장은 계속)', async () => {
  const { net, log } = network({ signStatus: 403 });
  const run = app(net);
  const out = await run(`uploadPhotoSettled('data:image/webp;base64,A','rep2',0)`);
  assert.equal(out, 'data:image/webp;base64,A');
  assert.equal(log.uploads.length, 0);
  assert.equal(log.sign, 1, '403 은 다시 보내도 같다 — 재시도하지 않는다');
  assert.equal(run('uploadFailed'), 1);
});

test('Cloudinary 가 서명을 거절(401)하면 새 서명으로 한 번 더 보낸다', async () => {
  const { net, log } = network({ rejectFirstAs: 401 });
  const run = app(net);
  const out = await run(`uploadPhotoSettled('data:image/webp;base64,A','rep3',0)`);
  assert.match(out, /^https:\/\/res\.test\.invalid\//);
  assert.equal(log.sign, 2);
  assert.equal(log.uploads.length, 2);
  assert.equal(log.uploads[1].fields.signature, 'sig2');
});

test('Cloudinary 의 다른 4xx(형식 거절 등)는 재시도하지 않고 원본을 남긴다', async () => {
  const { net, log } = network({ rejectFirstAs: 400 });
  const run = app(net);
  const out = await run(`uploadPhotoSettled('data:image/gif;base64,A','rep4',0)`);
  assert.equal(out, 'data:image/gif;base64,A');
  assert.equal(log.uploads.length, 1);
});

test('화면 소스에 무서명 프리셋이 없다', () => {
  assert.equal(html.includes('upload_preset'), false);
  assert.equal(html.includes('uploadPreset'), false);
  assert.equal(html.includes('ig-default'), false);
  assert.match(html, /fetch\('\/api\/cloudinary-sign'/);
});
