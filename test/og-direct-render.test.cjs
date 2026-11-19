const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const handler = require('../api/report.js');

test('공유 링크 /report/:id 는 0초 meta-refresh/JS 리다이렉트 없이 실측보고서 본문을 직접 서빙한다', () => {
  const baseHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const html = handler._renderReportHtml({
    baseHtml,
    id: '5ApMEarvVfevcdbp',
    title: '성수동 $& "현장" <A>',
    host: 'survey.igggstudio.com',
  });

  assert.equal(/http-equiv=["']refresh["']/i.test(html), false);
  assert.equal(/window\.location\.href\s*=/.test(html), false);
  assert.ok(html.includes('<meta property="og:title" content="성수동 $&amp; &quot;현장&quot; &lt;A&gt;">'));
  assert.ok(html.includes('<meta property="og:url" content="https://survey.igggstudio.com/report/5ApMEarvVfevcdbp">'));
  assert.ok(html.includes('<title>성수동 $&amp; &quot;현장&quot; &lt;A&gt; | 이견공간 실측보고서</title>'));
  assert.ok(html.includes('id="app"'));
});
