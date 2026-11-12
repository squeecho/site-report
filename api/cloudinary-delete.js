// POST /api/cloudinary-delete  { id: "<reportId>" }
// 보고서 삭제 시 해당 보고서의 Cloudinary 이미지(reports/{id}/*)를 정리.
// Cloudinary Admin API는 서명(api_secret)이 필요하므로 반드시 서버에서만 호출.
// 필요한 Vercel 환경변수:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//   (선택) CLEANUP_API_KEY  - 설정 시 x-api-key 헤더 일치해야 동작
//
// 보안 웨이브 4(2026-07-28): 무인증·CORS * 였던 삭제 창구에 직원 게이트를 붙였다.
// 호출자는 Authorization: Bearer <직원 id_token(iggg_sso 쿠키 → securetoken 교환)> 필수 —
// 백엔드 /api/staff/me 로 대조해 status=approved 만 통과(fail-closed 403).
const { ALLOWED_ORIGINS, bearerToken, isApprovedStaff, isReportId } = require("./_staff");

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 선택적 인증 가드
  const guard = process.env.CLEANUP_API_KEY;
  if (guard && req.headers["x-api-key"] !== guard) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 직원 게이트(필수) — Bearer 없거나 승인 직원이 아니면 403.
  // 환경변수 점검보다 앞에 둔다(비인증 호출에 설정 상태를 흘리지 않도록).
  if (!(await isApprovedStaff(bearerToken(req)))) {
    return res.status(403).json({ error: "승인된 직원만 사용할 수 있습니다." });
  }

  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) {
    return res.status(500).json({ error: "Cloudinary 환경변수(CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)가 설정되지 않았습니다." });
  }

  const id = (req.body && req.body.id) || req.query.id;
  if (!isReportId(id)) {
    return res.status(400).json({ error: "유효하지 않은 report id" });
  }

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const prefix = `reports/${id}`;

  try {
    // 1) prefix 하위 이미지 일괄 삭제 (최대 1000개)
    const delUrl = `https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload?prefix=${encodeURIComponent(prefix)}`;
    const r = await fetch(delUrl, { method: "DELETE", headers: { Authorization: auth } });
    const j = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: "Cloudinary 삭제 실패", detail: j });
    }

    // 2) 비워진 폴더 정리 (best-effort, 실패 무시)
    try {
      await fetch(`https://api.cloudinary.com/v1_1/${cloud}/folders/${encodeURIComponent(prefix)}`, {
        method: "DELETE",
        headers: { Authorization: auth },
      });
    } catch (e) { /* ignore */ }

    return res.status(200).json({ ok: true, deleted: j.deleted || {} });
  } catch (err) {
    console.error("cloudinary-delete error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
