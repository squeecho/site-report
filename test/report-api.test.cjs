const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the exported HTTP handler; only Firestore transport is substituted.
// No real credentials, document writes or network requests are available here.
const source = readFileSync(path.join(__dirname, '../api/report/[id].js'), 'utf8');
function fixture(data = {}, options = {}) {
  const calls = [];
  const admin = { apps: [{}], firestore: () => ({ collection(name) {
    assert.equal(name, 'reports');
    return { doc(id) { return { async get() {
      calls.push(id);
      if (options.failure) throw Error('transport failure');
      return { id, exists: options.exists !== false, data: () => structuredClone(data) };
    } }; } };
  } }) };
  const mod = { exports: {} };
  vm.runInNewContext(source, { module: mod, require(name) {
    assert.equal(name, 'firebase-admin'); return admin;
  }, process: { env: options.unconfigured ? {} : { IGGG_API_KEY: 'test-only' } },
  console: { error() {} } }, { filename: 'api/report/[id].js' });
  return { calls, async request(overrides = {}) {
    const req = { method: 'GET', headers: { 'x-api-key': 'test-only' }, query: { id: 'fixture' }, ...overrides };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(n) { this.statusCode = n; return this; },
      json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; }, end() { return this; } };
    await mod.exports(req, res);
    return res;
  } };
}

test('stored pyeong becomes explicit pyeong and square metres without altering the document', async () => {
  for (const [input, py, m2] of [[28.19, 28.19, 93.19], ['84.99', 84.99, 280.96], [' 1,234.5 ', 1234.5, 4080.99]]) {
    const doc = { measure: { area: input, ceilingFinish: '2774', floorPlan: ['fixture.png'] } };
    const before = structuredClone(doc), f = fixture(doc), r = await f.request();
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.measure.area_m2, m2);
    assert.equal(r.body.measure.area_pyeong, py);
    assert.equal(r.body.measure.ceiling_finish_mm, '2774');
    assert.deepEqual(doc, before);
    assert.deepEqual(f.calls, ['fixture']);
  }
});

test('unknown or invalid area stays null instead of becoming a usable quantity', async () => {
  for (const value of [undefined, null, '', ' ', 0, '0', -10, '-2', '28평', '12abc', NaN, Infinity, 'Infinity', true, false, [], {}, '1e309', '0x10', '1,2', 1e308]) {
    const r = await fixture({ measure: { area: value } }).request();
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.measure.area_pyeong, null, String(value));
    assert.equal(r.body.measure.area_m2, null, String(value));
  }
});

test('authentication, method and deleted/missing report boundaries remain unchanged', async () => {
  for (const [options, request, status, reads] of [
    [{ unconfigured: true }, {}, 503, 0],
    [{}, { headers: {} }, 401, 0],
    [{}, { headers: { 'x-api-key': 'wrong' } }, 401, 0],
    [{}, { method: 'OPTIONS', headers: {} }, 204, 0],
    [{}, { method: 'POST' }, 405, 0],
    [{}, { query: {} }, 400, 0],
    [{ exists: false }, {}, 404, 1],
    [{ failure: true }, {}, 500, 1],
  ]) {
    const f = fixture({}, options), r = await f.request(request);
    assert.equal(r.statusCode, status); assert.equal(f.calls.length, reads);
    assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  }
  const r = await fixture({ deleted: true, measure: { area: 99 } }).request();
  assert.equal(r.statusCode, 404); assert.equal(r.body.measure, undefined);
});

test('non-area report fields and raw storage stay compatible', async () => {
  const doc = { info: { siteName: 'test project', address: 'test address', date: '2026-10-02' },
    photos: { interior: ['a.png'], exterior: ['b.png'], video: ['v.mp4'] },
    fire: { notesTags: ['test note'] }, electric: { panelEntries: [{ phase: 'single', amps: '75' }] },
    facility: { ductTags: ['test duct'] }, sketch: { mode: 'draw', walls: [] },
    createdAt: { _seconds: 1790841600 }, status: 'draft' };
  const r = await fixture(doc).request();
  assert.equal(r.body.project_name, 'test project');
  assert.equal(r.body.photos.interior_count, 1); assert.equal(r.body.photos.video_count, 1);
  assert.deepEqual(r.body.fire.notes, ['test note']);
  assert.deepEqual(r.body.electric.panel_entries, doc.electric.panelEntries);
  assert.equal(r.body.status, 'draft');
  assert.equal(r.body.created_at, new Date(1790841600000).toISOString());
});
