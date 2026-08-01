// HTML 속성/텍스트 컨텍스트용 이스케이프
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
  const id = req.query.id;

  // Firestore 자동 ID 형식만 허용 (HTML/스크립트 주입 차단)
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    res.redirect('/');
    return;
  }

  let siteName = '';

  try {
    const projectId = 'site-report-63959';
    const apiKey = 'AIzaSyAv2Ls20EtMC6km1-DCG1tzWeI8DYRvNvY';
    const fsUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/reports/' + id + '?key=' + apiKey + '&mask.fieldPaths=info&mask.fieldPaths=deleted';

    const resp = await fetch(fsUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (resp.ok) {
      const doc = await resp.json();
      // 소프트 삭제면 OG 도 현장명을 내리지 않는다(전수검증 V5 ★2) —
      // 지운 보고서의 카톡 미리보기에 현장명이 계속 뜨면 안 된다.
      const isDeleted = !!(doc.fields && doc.fields.deleted && doc.fields.deleted.booleanValue);
      // Firestore REST API returns nested structure
      if (!isDeleted && doc.fields && doc.fields.info && doc.fields.info.mapValue && doc.fields.info.mapValue.fields) {
        const infoFields = doc.fields.info.mapValue.fields;
        if (infoFields.siteName && infoFields.siteName.stringValue) {
          siteName = infoFields.siteName.stringValue;
        }
      }
    }
  } catch (e) {
    // silently fail, use default
  }

  const title = siteName || '실측보고서';
  const host = req.headers.host || 'site-report-smoky.vercel.app';
  const ogImage = 'https://' + host + '/og-image.png';
  const redirectUrl = 'https://' + host + '/?id=' + id;

  // 모든 동적 값은 출력 컨텍스트에 맞게 이스케이프 (id는 위에서 형식 검증 완료)
  const titleEsc = escapeHtml(title);
  const hostEsc = escapeHtml(host);
  const ogImageEsc = escapeHtml(ogImage);
  const redirectUrlEsc = escapeHtml(redirectUrl);
  const redirectUrlJs = JSON.stringify(redirectUrl).replace(/</g, '\\u003c');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.status(200).send(
    '<!DOCTYPE html>' +
    '<html lang="ko"><head><meta charset="UTF-8">' +
    '<meta property="og:title" content="' + titleEsc + '">' +
    '<meta property="og:description" content="이견공간 실측보고서(basic)">' +
    '<meta property="og:image" content="' + ogImageEsc + '">' +
    '<meta property="og:image:width" content="1200">' +
    '<meta property="og:image:height" content="630">' +
    '<meta property="og:type" content="website">' +
    '<meta property="og:url" content="https://' + hostEsc + '/report/' + id + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + titleEsc + '">' +
    '<meta name="twitter:description" content="이견공간 실측보고서(basic)">' +
    '<meta name="twitter:image" content="' + ogImageEsc + '">' +
    '<title>' + titleEsc + ' | 이견공간 실측보고서</title>' +
    '<meta http-equiv="refresh" content="0;url=' + redirectUrlEsc + '">' +
    '</head><body>' +
    '<script>window.location.href=' + redirectUrlJs + ';</script>' +
    '</body></html>'
  );
};
