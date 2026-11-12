// 직원 게이트 공용 — api/cloudinary-delete.js · api/cloudinary-sign.js 가 같이 쓴다.
// 파일 이름이 '_' 로 시작하면 Vercel 이 이 파일을 함수 경로로 내보내지 않는다.
//
// 호출자는 Authorization: Bearer <직원 id_token(iggg_sso 쿠키 → securetoken 교환)> 필수 —
// 백엔드 /api/staff/me 로 대조해 status=approved 만 통과(fail-closed).
const STAFF_API = "https://iggg-estimate-api-583239150535.asia-northeast3.run.app";

// CORS 는 실제 서비스 도메인 + 로컬 개발만 허용(클라이언트 호출은 동일 출처라 프리플라이트도 없음).
const ALLOWED_ORIGINS = [
  "https://survey.igggstudio.com",
  "https://iggg-report.com",
  "https://www.iggg-report.com",
  "http://localhost:3000",
  "http://localhost:5173",
];

function bearerToken(req) {
  const authz = String((req.headers && req.headers.authorization) || "");
  return authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
}

// 승인 계정 판정 — "approved" | "denied"(토큰 없음 · 401/403 · 미승인) | "unavailable"(백엔드
// 5xx · 네트워크). 통과는 approved 뿐이다(fail-closed). unavailable 은 호출부가 503 으로 돌려
// 화면이 다시 시도할 수 있게 한다.
async function staffStatus(idToken) {
  if (!idToken) return "denied";
  try {
    const r = await fetch(`${STAFF_API}/api/staff/me`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (r.status === 401 || r.status === 403) return "denied";
    if (!r.ok) return "unavailable";
    const me = await r.json();
    return me && me.status === "approved" ? "approved" : "denied";
  } catch (e) {
    console.warn("staff 검증 실패:", e && e.message);
    return "unavailable";
  }
}

// 승인 계정인지 — 어떤 오류든 false(fail-closed).
async function isApprovedStaff(idToken) {
  return (await staffStatus(idToken)) === "approved";
}

// Firestore 자동 ID 형식만 허용 (경로 주입 방지)
function isReportId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id);
}

module.exports = { STAFF_API, ALLOWED_ORIGINS, bearerToken, staffStatus, isApprovedStaff, isReportId };
