// GET /api/report/[id]
// 견적 자동화 시스템용 실측보고서 데이터 API
const admin = require("firebase-admin");

// Firebase Admin 초기화 (Cold start 시 1회)
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // FIREBASE_SERVICE_ACCOUNT 미설정 시 기본 인증 시도 (GCP 환경 등)
    admin.initializeApp({
      projectId: "site-report-63959",
    });
  }
}

const db = admin.firestore();

// Firestore Timestamp → ISO string 변환
function toISO(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toISOString();
  return null;
}

// 안전한 배열 길이
function safeLen(arr) {
  return Array.isArray(arr) ? arr.length : 0;
}

// 안전한 배열 반환
function safeArr(arr) {
  return Array.isArray(arr) ? arr : [];
}

// Firestore doc → 견적 시스템용 JSON 변환
function formatReport(id, data) {
  const info = data.info || {};
  const fire = data.fire || {};
  const electric = data.electric || {};
  const facility = data.facility || {};
  const measure = data.measure || {};
  const construction = data.construction || {};
  const etc = data.etc || {};
  const photos = data.photos || {};
  const sketch = data.sketch || {};

  return {
    id,
    project_name: info.siteName || null,
    address: info.address || null,
    manager: info.manager || null,
    date: info.date || null,

    fire: {
      compliance: fire.compliance || null,
      sprinkler: fire.sprinkler || null,
      notes: safeArr(fire.notesTags),
    },

    electric: {
      panel_entries: safeArr(electric.panelEntries),
      hvac: electric.hvac || null,
      notes: electric.notes || null,
      panel_location: electric.panelLocation || null,
    },

    facility: {
      water_meter: facility.waterMeter || null,
      water_supply: facility.waterSupply || null,
      drainage: facility.drainage || null,
      gas_entry: facility.gasEntry || null,
      gas_heater: facility.gasHeater || null,
      duct: safeArr(facility.ductTags),
      notes: facility.notes || null,
    },

    measure: {
      ceiling_finish_mm: measure.ceilingFinish || null,
      ceiling_slab_mm: measure.ceilingSlab || null,
      ceiling_beam_mm: measure.ceilingBeam || null,
      area_m2: measure.area || null,
      has_floor_plan: !!(measure.floorPlan),
    },

    construction: {
      parking: construction.parking || null,
      parking_detail: construction.parkingDetail || null,
      stair_elevator: construction.stairElevator || null,
      material_route: construction.materialRoute || null,
      building_protection: construction.buildingProtection || null,
    },

    etc: {
      illegal_building: etc.illegalBuilding || null,
      leak: etc.leak || null,
      notes: etc.notes || null,
    },

    photos: {
      exterior_count: safeLen(photos.exterior),
      interior_count: safeLen(photos.interior),
      video_count: safeLen(photos.video),
      exterior_urls: safeArr(photos.exterior),
      interior_urls: safeArr(photos.interior),
    },

    sketch: {
      has_sketch: !!(sketch.drawing || sketch.walls),
      mode: sketch.mode || null,
    },

    status: data.status || null,
    created_at: toISO(data.createdAt),
    updated_at: toISO(data.updatedAt),
  };
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // API Key 인증 — **fail-closed**(감사 2026-07-30 백로그 #16).
  // ⚠예전엔 `if (apiKey)` 로 감싸 **키 미설정이면 검사를 통째로 건너뛰었다**.
  //   키를 지우거나 회전 중 오타가 나면 주소·담당자·전 사진 URL·전 실측값이
  //   무인증 공개된다(CORS 도 `*`). 같은 리포의 cloudinary-delete.js 는 이미
  //   fail-closed 다 — 그 규약으로 통일한다. 로컬 개발은 .env 에 키를 넣어 쓴다.
  const apiKey = process.env.IGGG_API_KEY;
  if (!apiKey) {
    console.error("[report/[id]] IGGG_API_KEY 미설정 — 요청 거부(fail-closed)");
    return res.status(503).json({ error: "서버 설정 오류: 인증 키가 없습니다." });
  }
  if (req.headers["x-api-key"] !== apiKey) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing x-api-key" });
  }

  // Report ID
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: "Missing report id" });
  }

  try {
    const doc = await db.collection("reports").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Report not found", id });
    }

    const result = formatReport(doc.id, doc.data());
    return res.status(200).json(result);
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
