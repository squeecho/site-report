# 실측보고서 조회와 작성 구분 — 2026-10-06

목표: 저장된 보고서 조회·링크 복사·뒤로가기는 작성 중으로 표시하지 않고, 실제 미저장 변경만 복구한다.

| 항목 | 상태 | 우선순위 | 증거 |
|---|---|---|---|
| 조회·복사 뒤 초안 생성 방지 | parity | P0 | 운영 기존본에서 직접 재현. 내용 기준 비교, 로컬 모바일 UI 통과 |
| 편집 직후 뒤로가기/목록에서 수정분 보존 | parity | P0 | 3초 타이머 전 뒤로가기, 새로고침 후 이어쓰기 UI 통과 |
| 기존 잘못 생성된 초안 정리 | parity | P0 | 성공적으로 읽은 서버 저장본과 같은 내용만 제거. 수정·미조회·삭제 보고서는 유지 |
| 저장 성공 후 초안 재생성 방지 | parity | P0 | 저장 후 타이머 경과 UI, 전체 JS saveReport 회귀시험 |
| 사진 업로드 실패분 보존 | parity | P0 | saveReport 실제 함수 + 업로드 transport 실패 회귀시험 |
| 링크복사 알림 중 뒤로가기 | parity | P1 | z-index 대신 실제 사진 확대창만 닫기. 알림 표시 중 뒤로가기 UI 통과 |
| 배포 후 실보고서 재확인 | partial | P0 | 배포 후 기록 예정 |

## 경쟁 가설과 관측
1. 링크 복사가 내용을 수정한다: 기각. `renderReport`의 공유 버튼은 clipboard와 toast만 사용한다.
2. 화면 진입만으로 초안 저장: 확인. 기존 `shouldAutoSave`가 화면 종류만 검사하고 `autoSave`가 매번 초안을 만들었다. 운영에서 유박사차이니즈 안산 조회·복사·뒤로가기만으로 재현했다.
3. 다른 보고서의 초안 식별자 재사용: 코드에서 위험 확인. `loadReportForEdit`에서 식별자를 초기화하고, 다른 현장 조회가 기존 수정 초안을 보존하는 시험으로 검증했다.

## 구현 및 영향 경로
- `index.html`: `reportSnapshot`은 기존 보고서 9개 섹션의 실제 내용 정규화 비교. 기본 누락 필드, 사진 빈 태그, 차단기 UI 플래그만 동등화. 사진 data URI 포함, 사진 업로드용 투영 재사용 금지.
- 열기/새 작성/초안 이어쓰기/저장 성공의 기준 내용 설정. 타이머·앱 숨김·페이지 이탈·뒤로가기·목록 이동 모두 기존 `autoSave` 경로 사용.
- `fetchReports` 성공 때만 기존 동일 초안을 정리. 서버 문서 수정/삭제 없음. 다른 기기 서버 변경과 내용이 다르면 보존.
- 사진 확대창은 전용 속성으로 식별. 복사 알림·인쇄 푸터가 뒤로가기를 가로채지 않는다.

## 검증
- `node --test test/*.test.cjs`: 8/8. 프로덕션 inline JS를 실행하고 DOM/Firestore/사진 전송만 대체.
- 모바일 Chromium 390×844, 실제 버튼·입력·브라우저 뒤로가기: 7개 흐름 통과, pageerror 0.
- 시험 경로: `archive/site-report-draft-fix-20261006/ui-test.cjs`, `ui-result.json`, `after-read-mobile.png`, `after-edit-mobile.png` (상위 studio 기준).
- 실제 기기 터치는 미검증. 변경/저장 시험은 로컬 Firestore 대역만 사용했고 실제 고객 문서는 수정하지 않았다.
- 정적 HTML 앱으로 별도 build 스크립트 없음. 전체 inline JS 컴파일 및 실제 Chromium 렌더로 확인.

## Git/배포 보호
- 운영 시작 SHA: `7f53e041afbf1ab42f2d4010f6521ea6cebafc52`, site-report / `dpl_GR1q729FRWBNTZ3CH7Cf1FUmoH3L`.
- 기존 main 로컬 전용 `a3950cd`(면적 API 변환)는 보호. 긴급 수정은 운영 SHA 기반 별도 worktree에서 만들었으며 해당 API 변경을 배포에 섞지 않는다.
