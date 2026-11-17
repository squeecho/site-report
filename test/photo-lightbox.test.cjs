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
      this.style = {};
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
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    emit(type, evt = {}) {
      (this.listeners[type] || []).forEach((fn) => fn({ target: this, stopPropagation() {}, ...evt }));
      if (type === 'click' && typeof this.onclick === 'function') {
        this.onclick({ target: this, stopPropagation() {}, ...evt });
      }
    }
    set innerHTML(val) {
      this._html = String(val);
      if (this.getAttribute('data-report-lightbox') === '1') {
        this._parseLightbox();
      }
    }
    get innerHTML() { return this._html; }
    _parseLightbox() {
      this.children = [];
      const counterM = this._html.match(/data-lb-counter[^>]*>([^<]+)</);
      if (counterM) {
        const el = new FakeEl('div');
        el.setAttribute('data-lb-counter', '');
        el.textContent = counterM[1];
        this.appendChild(el);
      }
      const groupM = this._html.match(/data-lb-group[^>]*>([^<]+)</);
      if (groupM) {
        const el = new FakeEl('span');
        el.setAttribute('data-lb-group', '');
        el.textContent = groupM[1];
        this.appendChild(el);
      }
      const body = new FakeEl('div');
      body.setAttribute('id', 'lbBody');
      const imgM = this._html.match(/<img[^>]*src="([^"]+)"/);
      if (imgM) {
        const img = new FakeEl('img');
        img.setAttribute('src', imgM[1]);
        body.appendChild(img);
      }
      if (/id="lbPrev"/.test(this._html)) {
        const prev = new FakeEl('button');
        prev.setAttribute('id', 'lbPrev');
        body.appendChild(prev);
      }
      if (/id="lbNext"/.test(this._html)) {
        const next = new FakeEl('button');
        next.setAttribute('id', 'lbNext');
        body.appendChild(next);
      }
      const close = new FakeEl('button');
      close.setAttribute('id', 'lbClose');
      this.appendChild(close);
      this.appendChild(body);
      for (const m of this._html.matchAll(/data-lb-dot="(\d+)"/g)) {
        const d = new FakeEl('button');
        d.setAttribute('data-lb-dot', m[1]);
        this.appendChild(d);
      }
    }
    _walk(pred, acc = []) {
      for (const c of this.children) {
        if (pred(c)) acc.push(c);
        c._walk(pred, acc);
      }
      return acc;
    }
    querySelectorAll(sel) {
      if (sel === '[data-lb-dot]') return this._walk((el) => el.getAttribute('data-lb-dot') !== null);
      if (sel === '[data-photo-cell]') return this._walk((el) => el.getAttribute('data-photo-cell') !== null);
      if (sel === '[data-print-photo]') return this._walk((el) => el.getAttribute('data-print-photo') !== null);
      return [];
    }
    querySelector(sel) {
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        return this._walk((el) => el.getAttribute('id') === id)[0] || null;
      }
      return this._walk((el) => sel === '[data-report-lightbox]'
        ? el.getAttribute('data-report-lightbox') === '1'
        : sel === '[data-lb-counter]'
          ? el.getAttribute('data-lb-counter') !== null
          : sel === '[data-lb-group]'
            ? el.getAttribute('data-lb-group') !== null
            : sel === 'img'
              ? el.tagName === 'IMG'
              : false)[0] || null;
    }
  }
  const body = new FakeEl('body');
  const docEvents = {};
  const winEvents = {};
  const loadedImages = [];
  const document = {
    cookie: '',
    body,
    documentElement: new FakeEl('html'),
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (t) => { const n = new FakeEl('#text'); n.textContent = String(t); return n; },
    getElementById: () => null,
    querySelector: (sel) => body.querySelector(sel),
    contains: (el) => body.children.includes(el),
    addEventListener: (k, f) => { (docEvents[k] ||= []).push(f); },
    removeEventListener: (k, f) => {
      if (docEvents[k]) docEvents[k] = docEvents[k].filter((fn) => fn !== f);
    },
  };
  document.body.contains = (el) => body.children.includes(el);

  const storage = new Map();
  const ctx = vm.createContext({
    URLSearchParams,
    console,
    setTimeout() {},
    setInterval() {},
    Image: function () { const img = {}; loadedImages.push(img); return img; },
    location: { pathname: '/report/test', search: '', origin: 'https://test.invalid' },
    history: {
      pushState() {},
      replaceState() {},
      back() { (winEvents.popstate || []).forEach((fn) => fn({ state: null })); },
    },
    document,
    window: {
      matchMedia() { return { matches: false, addEventListener() {} }; },
      addEventListener(k, f) { (winEvents[k] ||= []).push(f); },
      removeEventListener(k, f) {
        if (winEvents[k]) winEvents[k] = winEvents[k].filter((fn) => fn !== f);
      },
    },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
  });
  ctx.window.document = document;
  ctx.window.history = ctx.history;

  vm.runInContext(source.replace(/\nrender\(\);\s*$/, '\n'), ctx);
  return { ctx, body, docEvents, loadedImages };
}

test('외부 마지막 사진에서 다음 넘김/스와이프 시 내부 첫 사진으로 이어진다', () => {
  const { ctx, body, docEvents } = createDom();
  vm.runInContext(`
    viewMode = true;
    data = makeInitialData();
    data.info = { siteName: '서울곱창 일산점', date: '2026-11-17', manager: 'A', address: '' };
    data.photos = {
      exterior: ['https://img/ext-1.jpg', 'https://img/ext-2.jpg', 'https://img/ext-3.jpg', 'https://img/ext-4.jpg'],
      interior: ['https://img/int-1.jpg', 'https://img/int-2.jpg', 'https://img/int-3.jpg'],
      interiorTags: [],
      video: ''
    };
  `, ctx);

  const report = vm.runInContext('renderReport()', ctx);
  const cells = report.querySelectorAll('[data-photo-cell]');
  assert.equal(cells.length, 7);

  // 4번째 외부 사진 클릭 → 4 / 7 · 외부 4/4 표시 및 다음 버튼(#lbNext) 활성
  cells[3].emit('click');
  const lb = body.querySelector('[data-report-lightbox]');
  assert.ok(lb);
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '4 / 7');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '외부 4/4');
  assert.equal(lb.querySelector('img').getAttribute('src'), 'https://img/ext-4.jpg');
  assert.ok(lb.querySelector('#lbNext'));

  // › 클릭 → 내부 첫 번째 사진으로 이어짐
  lb.querySelector('#lbNext').emit('click');
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '5 / 7');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '내부 1/3');
  assert.equal(lb.querySelector('img').getAttribute('src'), 'https://img/int-1.jpg');

  // ‹ 클릭 → 다시 외부 4번째 사진으로 복귀
  lb.querySelector('#lbPrev').emit('click');
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '4 / 7');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '외부 4/4');
  assert.equal(lb.querySelector('img').getAttribute('src'), 'https://img/ext-4.jpg');

  // 왼쪽으로 터치 스와이프 → 내부 첫 사진으로 이동, ArrowLeft → 다시 외부 마지막
  const lbBody = lb.querySelector('#lbBody');
  lbBody.emit('touchstart', { touches: [{ clientX: 280, clientY: 300 }] });
  lbBody.emit('touchmove', { touches: [{ clientX: 140, clientY: 305 }] });
  lbBody.emit('touchend');
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '5 / 7');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '내부 1/3');

  docEvents.keydown.forEach((fn) => fn({ key: 'ArrowLeft' }));
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '4 / 7');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '외부 4/4');

  lb.querySelector('#lbClose').emit('click');
  assert.equal(body.querySelector('[data-report-lightbox]'), null);
});

test('내부 구역이 여러 개여도 외부 → 내부 구역 순으로 이어지고 실측도면은 분리 유지된다', () => {
  const { ctx, body } = createDom();
  vm.runInContext(`
    viewMode = true;
    data = makeInitialData();
    data.info = { siteName: '테스트', date: '2026-11-17', manager: 'A', address: '' };
    data.photos = {
      exterior: ['https://img/e1.jpg', 'https://img/e2.jpg'],
      interior: ['https://img/i-hall.jpg', 'https://img/i-kit.jpg'],
      interiorTags: ['홀', '주방'],
      video: ''
    };
    data.measure.floorPlan = ['https://img/plan-1.jpg', 'https://img/plan-2.jpg'];
  `, ctx);

  const report = vm.runInContext('renderReport()', ctx);
  const cells = report.querySelectorAll('[data-photo-cell]');
  assert.equal(cells.length, 6);

  // 외부 2번째 → 다음(내부 — 홀) → 다음(내부 — 주방)
  cells[1].emit('click');
  const lb = body.querySelector('[data-report-lightbox]');
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '2 / 4');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '외부 2/2');

  lb.querySelector('#lbNext').emit('click');
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '3 / 4');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '내부 — 홀');
  assert.equal(lb.querySelector('img').getAttribute('src'), 'https://img/i-hall.jpg');

  lb.querySelector('#lbNext').emit('click');
  assert.equal(lb.querySelector('[data-lb-counter]').textContent, '4 / 4');
  assert.equal(lb.querySelector('[data-lb-group]').textContent, '내부 — 주방');
  assert.equal(lb.querySelector('img').getAttribute('src'), 'https://img/i-kit.jpg');
  assert.equal(lb.querySelector('#lbNext'), null);

  lb.querySelector('#lbClose').emit('click');

  // 실측도면은 현장사진과 섞이지 않고 별도(2장) 열람
  cells[4].emit('click');
  const lbPlan = body.querySelector('[data-report-lightbox]');
  assert.equal(lbPlan.querySelector('[data-lb-counter]').textContent, '1 / 2');
  assert.equal(lbPlan.querySelector('[data-lb-group]').textContent, '실측도면 1/2');
});
