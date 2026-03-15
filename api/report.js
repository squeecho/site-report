module.exports = async function handler(req, res) {
  const id = req.query.id;

  if (!id) {
    res.redirect('/');
    return;
  }

  let siteName = '';

  try {
    const projectId = 'site-report-63959';
    const apiKey = 'AIzaSyAv2Ls20EtMC6km1-DCG1tzWeI8DYRvNvY';
    const fsUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/reports/' + id + '?key=' + apiKey + '&mask.fieldPaths=info';

    const resp = await fetch(fsUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (resp.ok) {
      const doc = await resp.json();
      // Firestore REST API returns nested structure
      if (doc.fields && doc.fields.info && doc.fields.info.mapValue && doc.fields.info.mapValue.fields) {
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

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.status(200).send(
    '<!DOCTYPE html>' +
    '<html lang="ko"><head><meta charset="UTF-8">' +
    '<meta property="og:title" content="' + title + '">' +
    '<meta property="og:description" content="이견공간 실측보고서(basic)">' +
    '<meta property="og:image" content="' + ogImage + '">' +
    '<meta property="og:image:width" content="1200">' +
    '<meta property="og:image:height" content="630">' +
    '<meta property="og:type" content="website">' +
    '<meta property="og:url" content="https://' + host + '/report/' + id + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + title + '">' +
    '<meta name="twitter:description" content="이견공간 실측보고서(basic)">' +
    '<meta name="twitter:image" content="' + ogImage + '">' +
    '<title>' + title + ' | 이견공간 실측보고서</title>' +
    '<meta http-equiv="refresh" content="0;url=' + redirectUrl + '">' +
    '</head><body>' +
    '<script>window.location.href="' + redirectUrl + '";</script>' +
    '</body></html>'
  );
};
