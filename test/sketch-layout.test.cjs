const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function createDom() {
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attrs = {};
      this.dataset = {};
      this.style = { cssText: '' };
      this.listeners = {};
      this.parentNode = null;
      this.nodeType = tag === '#text' ? 3 : 1;
      this._html = '';
      this.textContent = '';
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    appendChild(child) { if (child) { child.parentNode = this; this.children.push(child); } return child; }
    insertBefore(child, ref) {
      if (!child) return child;
      child.parentNode = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.unshift(child);
      return child;
    }
    get firstChild() { return this.children[0] || null; }
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      }
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    set innerHTML(val) { this._html = String(val); if (!val) this.children = []; }
    get innerHTML() { return this._html; }
    querySelectorAll(sel) {
      const attrs = sel.split(',').map((s) => s.trim().replace(/^\[|\]$/g, ''));
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (attrs.some((a) => c.getAttribute(a) !== null)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  const app = new FakeEl('div');
  app.attrs.id = 'app';
  const document = {
    body: new FakeEl('body'),
    documentElement: new FakeEl('html'),
    title: '',
    createElement(tag) { return new FakeEl(tag); },
    createElementNS(_ns, tag) { return new FakeEl(tag); },
    createTextNode(txt) { const n = new FakeEl('#text'); n.textContent = String(txt); return n; },
    getElementById(id) { return id === 'app' ? app : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return { FakeEl, app, document };
}

function bootApp() {
  const dom = createDom();
  const noop = () => {};
  const ctx = {
    document: dom.document,
    window: {
      location: { pathname: '/', search: '', origin: 'https://survey.igggstudio.com', hash: '' },
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      scrollTo: noop,
      addEventListener: noop,
      removeEventListener: noop,
      innerHeight: 844,
    },
    location: { pathname: '/', search: '', origin: 'https://survey.igggstudio.com', hash: '' },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    history: { replaceState: noop, pushState: noop },
    URLSearchParams,
    Image: class { set src(_) {} },
    alert: noop,
    confirm: () => true,
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    requestAnimationFrame: () => 0,
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    AbortController: class { abort() {} },
    firebase: undefined,
    GUEST_ENTRY: true,
    console: { log: noop, warn: noop, error: noop },
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(source, ctx);
  return { dom, ctx };
}

function findByAttr(root, attr, val) {
  const out = [];
  const walk = (n) => {
    if (n.getAttribute && n.getAttribute(attr) === val) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

function boxOverlap(a, b) {
  const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

test('모서리 밀집 배치(출입구·설비 5종+)에서도 라벨과 앵커가 겹치거나 도면 밖으로 잘리지 않는다', () => {
  const { ctx } = bootApp();
  const denseCluster = [
    { x: 22, y: 34, emoji: '🚪', label: '출입구', no: 0, type: 'door' },
    { x: 80, y: 22, emoji: '🚪', label: '출입구', no: 0, type: 'door' },
    { x: 77, y: 37, emoji: '🚰', label: '급수', no: 1, type: 'supply' },
    { x: 78, y: 43, emoji: '🕳', label: '배수', no: 2, type: 'drain' },
    { x: 82, y: 27, emoji: '🔥', label: '가스배관', no: 3, type: 'gas' },
    { x: 54, y: 62, emoji: '⚡', label: '분전함', no: 4, type: 'panel' },
    { x: 74, y: 17, emoji: '💧', label: '수도계량기', no: 5, type: 'water' },
  ];
  const layouts = ctx.sketchLayoutMarks(denseCluster, { aspect: 4 / 3, scale: 0.95 });
  assert.equal(layouts.length, denseCluster.length);

  const boxes = layouts.map((l) => ({
    x1: l.lx - l.bw / 2,
    y1: l.ly - l.bh / 2,
    x2: l.lx + l.bw / 2,
    y2: l.ly + l.bh / 2,
  }));

  for (let i = 0; i < boxes.length; i++) {
    assert.ok(boxes[i].x1 >= 0 && boxes[i].x2 <= 100, `callout ${i} X out of bounds: ${JSON.stringify(boxes[i])}`);
    assert.ok(boxes[i].y1 >= 0 && boxes[i].y2 <= 100, `callout ${i} Y out of bounds: ${JSON.stringify(boxes[i])}`);
    for (let j = i + 1; j < boxes.length; j++) {
      assert.equal(boxOverlap(boxes[i], boxes[j]), 0, `callouts ${i} and ${j} overlap`);
    }
    for (let a = 0; a < layouts.length; a++) {
      const anchorBox = {
        x1: layouts[a].ax - 2.3,
        y1: layouts[a].ay - 2.3 * (4 / 3),
        x2: layouts[a].ax + 2.3,
        y2: layouts[a].ay + 2.3 * (4 / 3),
      };
      assert.equal(boxOverlap(boxes[i], anchorBox), 0, `callout ${i} overlaps anchor ${a}`);
    }
  }
});

test('극단적 구석 10핀 + 세로 사진 비율에서도 라벨 겹침 없이 분산 배치된다', () => {
  const { ctx } = bootApp();
  const extreme = Array.from({ length: 10 }, (_, i) => ({
    x: 84 + (i % 3) * 5,
    y: 5 + Math.floor(i / 3) * 4,
    emoji: '💧',
    label: i % 2 === 0 ? '수도계량기' : '급수',
    no: i + 1,
    type: i % 2 === 0 ? 'water' : 'supply',
  }));
  const layouts = ctx.sketchLayoutMarks(extreme, { aspect: 0.65, scale: 0.95 });
  const boxes = layouts.map((l) => ({
    x1: l.lx - l.bw / 2,
    y1: l.ly - l.bh / 2,
    x2: l.lx + l.bw / 2,
    y2: l.ly + l.bh / 2,
  }));
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(boxes[i].x1 >= 0 && boxes[i].x2 <= 100);
    assert.ok(boxes[i].y1 >= 0 && boxes[i].y2 <= 100);
    for (let j = i + 1; j < boxes.length; j++) {
      assert.equal(boxOverlap(boxes[i], boxes[j]), 0, `extreme callouts ${i} and ${j} overlap`);
    }
  }
});

test('직접 스케치 보고서 렌더링은 벡터 SVG 평면도와 지시선·라벨을 생성하고 스냅샷 스키마를 오염시키지 않는다', () => {
  const { dom, ctx } = bootApp();
  const snapBefore = ctx.reportSnapshot(ctx.data);
  const presets = vm.runInNewContext('SKETCH_PRESETS', ctx);
  assert.ok(Array.isArray(presets) && presets.length >= 4);

  vm.runInNewContext(`
    currentView = 'report';
    viewMode = true;
    showReport = true;
    data.info.siteName = '서울곱창 일산점';
    data.sketch = {
      v: 2,
      mode: 'draw',
      bgPhoto: null,
      drawing: null,
      polygon: [{x:16,y:18},{x:46,y:18},{x:46,y:25},{x:51,y:25},{x:51,y:18},{x:81,y:18},{x:81,y:45},{x:78,y:45},{x:78,y:62},{x:53,y:62},{x:53,y:73},{x:21,y:73},{x:21,y:25},{x:16,y:25}],
      doors: [{id:1,x:22,y:34},{id:2,x:80,y:22}],
      pins: [
        {id:11,type:'supply',x:77,y:37,note:''},
        {id:12,type:'drain',x:78,y:43,note:''},
        {id:13,type:'gas',x:82,y:27,note:''},
        {id:14,type:'panel',x:54,y:62,note:''},
        {id:15,type:'water',x:74,y:17,note:'현장 뒷문쪽'}
      ]
    };
    render();
  `, ctx);

  assert.equal(findByAttr(dom.app, 'data-sketch-floor', '1').length, 1);
  assert.equal(findByAttr(dom.app, 'data-sk-leaders', '1').length, 1);
  assert.equal(findByAttr(dom.app, 'data-sk-mark', '1').length, 7);
  assert.equal(findByAttr(dom.app, 'data-sk-callout', '1').length, 7);
  assert.equal(findByAttr(dom.app, 'data-sketch-legend', '1').length, 1);

  // 선택/하이라이트 등 편집 UI 상태가 data.sketch 영속 스냅샷에 섞이지 않아야 한다
  vm.runInNewContext(`
    data = makeInitialData();
    sketchSelectedMid = 'pin-99';
    sketchHighlightId = 'pin-99';
  `, ctx);
  assert.equal(ctx.reportSnapshot(ctx.data), snapBefore);
});
