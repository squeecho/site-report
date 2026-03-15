export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    res.redirect('/');
    return;
  }

  let siteName = '실측보고서';

  try {
    // Fetch from Firestore REST API (no admin SDK needed)
    const projectId = 'site-report-63959';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/reports/${id}?mask.fieldPaths=info`;
    const resp = await fetch(url);

    if (resp.ok) {
      const doc = await resp.json();
      const infoFields = doc.fields?.info?.mapValue?.fields;
      if (infoFields?.siteName?.stringValue) {
        siteName = infoFields.siteName.stringValue;
      }
    }
  } catch (e) {
    console.error('Firestore fetch error:', e);
  }

  const ogTitle = siteName;
  const ogDesc = '이견공간 실측보고서(basic)';
  const ogImage = `https://${req.headers.host}/og-image.png`;
  const redirectUrl = `https://${req.headers.host}/?id=${id}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="${ogImage}">
<title>${ogTitle} | 이견공간 실측보고서</title>
<meta http-equiv="refresh" content="0;url=${redirectUrl}">
</head>
<body>
<script>window.location.href="${redirectUrl}";</script>
</body>
</html>`);
}
