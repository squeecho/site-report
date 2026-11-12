// POST /api/cloudinary-sign  { id: "<reportId>" }
// 실측보고서 사진 업로드용 Cloudinary 서명 발급(보안 감사 2026-11-12 #12).
// 예전엔 화면이 무서명 프리셋으로 바로 올렸다 — 프리셋 이름만 알면 누구나 이 계정에
// 올릴 수 있었다. 이제 승인 직원만 서명을 받고, 서명이 폴더 · 형식을 묶는다.
//
// 서명에 넣는 값(Cloudinary 는 서명된 값과 다르게 보낸 요청을 거부한다):
//   folder          = reports/{id}  (서버가 만든다 — 화면이 다른 폴더를 고를 수 없다)
//   allowed_formats = jpg,png,webp  (사진 압축은 webp/jpeg, 스케치 굽기는 png)
//   timestamp       = 지금(초). Cloudinary 는 서명을 1시간 동안만 받아 준다.
// ⚠ 업로드 바이트 상한은 업로드 API 에 서명할 수 있는 값이 없다. 상한은 화면의
//   압축(장변 1200~2000px)과 Cloudinary 계정 한도가 맡는다.
//
// 필요한 Vercel 환경변수(cloudinary-delete 와 같음):
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
const crypto = require("crypto");
const { ALLOWED_ORIGINS, bearerToken, staffStatus, isReportId } = require("./_staff");

const ALLOWED_FORMATS = "jpg,png,webp";

// Cloudinary 서명 규칙: file · cloud_name · resource_type · api_key 를 뺀 보낼 값 전부를
// 이름 순으로 name=value 를 & 로 잇고, 뒤에 API secret 을 붙여 SHA-1 16진수.
function signParams(params, secret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + secret).digest("hex");
}

async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 승인 계정 게이트(필수) — 환경변수 점검보다 앞에 둔다(비인증 호출에 설정 상태를 흘리지 않도록).
  // 백엔드 장애는 403 이 아니라 503 — 화면이 거절로 알고 재시도를 멈추지 않게 한다.
  const who = await staffStatus(bearerToken(req));
  if (who === "unavailable") {
    return res.status(503).json({ error: "계정 확인 서버에 연결할 수 없습니다 — 잠시 후 다시 시도해 주세요." });
  }
  if (who !== "approved") {
    return res.status(403).json({ error: "승인된 계정만 사진을 올릴 수 있습니다." });
  }

  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) {
    return res.status(500).json({ error: "Cloudinary 환경변수(CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)가 설정되지 않았습니다." });
  }

  const id = req.body && req.body.id;
  if (!isReportId(id)) {
    return res.status(400).json({ error: "유효하지 않은 report id" });
  }

  const params = {
    allowed_formats: ALLOWED_FORMATS,
    folder: `reports/${id}`,
    timestamp: Math.floor(Date.now() / 1000),
  };
  return res.status(200).json({
    cloudName: cloud,
    apiKey: key,
    folder: params.folder,
    allowedFormats: params.allowed_formats,
    timestamp: params.timestamp,
    signature: signParams(params, secret),
  });
}

module.exports = handler;
module.exports.signParams = signParams;
module.exports.ALLOWED_FORMATS = ALLOWED_FORMATS;
