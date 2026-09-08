# NEXT_WORK.md

## 현재 완료: architecture / domain / Worker+D1 / Google session / authorized CRUD / live mobile UI baseline

- [x] Vite + TypeScript + 기본 DOM/CSS, 런타임 프레임워크 없음
- [x] Workers Static Assets 개발 preview 및 `work/*` 자동 preview 경로
- [x] 누적 kWh 문자열 → 정확한 정수 Wh, 절대 epoch-millisecond reading 계약
- [x] 구간 사용량·경과시간·평균 소비전력, 일자별 분할/보간과 `actual / interpolated` provenance
- [x] 검침 마감 `1~31일 + 월말`, 고정 날짜가 없는 달의 월말 자동 보정, 이전/현재/다음 검침주기와 경계 보간
- [x] 최근 구간/최근 완전 일자/주기 평균, 마감 예상, 30일 환산, 이전 주기 비교와 confidence evidence
- [x] 월말/연말/윤년/DST 및 UTC / Asia-Seoul process timezone 자동 검증
- [x] 동일-origin Worker API + D1 schema/migration/persistence + local workerd round trip
- [x] Google GIS ID token 검증, Google `sub` → 내부 user, 서명 HttpOnly session
- [x] 모든 meter/readings route의 server-side owner/viewer authorization
- [x] owner meter/readings CRUD, viewer read-only, exact instant 중복과 누적값 역행 방지
- [x] frontend same-origin API client가 auth/session, meters, readings만 알고 SQL/D1 세부를 알지 않음
- [x] UI가 인증 미설정 / signed-out / signed-in / loading / API error를 구분
- [x] Google GIS callback credential을 기존 CSRF-protected `/api/auth/google`에 전달하고 정상 session을 다시 확인하는 frontend flow
- [x] 첫 로그인 사용자의 첫 meter 생성, owner/viewer meter 선택, viewer read-only UI
- [x] owner 홈 빠른 입력이 현재 시각 + 누적 kWh를 POST하고 성공 후 raw readings를 다시 조회
- [x] 화면 usage/daily/billing/forecast가 `src/demo.ts` 고정 숫자가 아니라 실제 raw readings + meter 설정으로 계산
- [x] owner 설정에서 `1~31일 + 월말` 선택·저장, viewer 설정 read-only
- [x] tariff 미연결 상태에서는 가짜 요금을 표시하지 않고 명시적으로 미연결 상태를 표시
- [x] deterministic Playwright API/GIS mock으로 auth/owner/viewer/첫 meter/API 실패/빠른 입력/월말 설정/320px/keyboard 회귀 보호
- [x] `.dev.vars` / `.env` 계열 Secret 파일 Git 제외
- [x] build + persistence + local D1/workerd + Worker/auth/resource API + domain + Playwright GitHub Actions verify 경로 유지

현재 UI는 실제 repository API/domain 계약을 사용합니다. 다만 실제 Cloudflare remote D1 database/binding, Google Client ID/SESSION_SECRET 환경값과 실제 Google Provider 로그인은 아직 구성하지 않았으므로 repository test에서는 deterministic mock과 local D1/workerd만 사용합니다.

## 완료 WorkUnit: 모바일 UI와 auth/API/domain 연결 baseline

현재 계약:

1. `src/api.ts`가 frontend same-origin HTTP 경계를 소유하고 `/api/auth/*`, `/api/meters*`만 호출합니다. SQL/D1 binding은 frontend로 새지 않습니다.
2. `/api/auth/session`이 503이면 인증 환경 미설정, 401이면 Google 로그인 가능 상태, 정상 session이면 product UI로 진입합니다.
3. Google GIS script는 Client ID가 서버 `/api/auth/config`에서 실제 제공되는 signed-out 상태에서만 로드합니다. frontend callback은 host-only `g_csrf_token` cookie/body를 맞춰 기존 서버 double-submit 검증을 그대로 통과해야 합니다.
4. 로그인 사용자는 접근 가능한 owner/viewer meter만 선택합니다. owner는 기록·설정 mutation이 가능하고 viewer는 조회 전용입니다. 권한의 정본은 계속 서버/API입니다.
5. meter가 없는 첫 사용자는 이름, IANA timezone, 검침 마감만 입력해 meter를 생성합니다. owner identity와 resource ID는 client body에서 받지 않습니다.
6. owner 홈 빠른 입력은 현재 `Date.now()`와 decimal kWh를 reading API에 저장하고 성공 뒤 meter/readings를 다시 조회합니다. localStorage/offline write queue는 추가하지 않았습니다.
7. 최신 구간, 최근 완전 일자 평균, 현재 검침주기, 마감 예상, 30일 환산, 이전 주기 비교, 일별 보간은 기존 순수 domain을 재사용합니다. 최신 raw reading이 오늘의 검침주기에 속하지 않으면 과거 cycle forecast를 현재 cycle 값처럼 표시하지 않습니다.
8. 검침 마감 UI는 `1..31` 또는 별도 `월말`입니다. 29~31일 고정값이 없는 달에는 domain이 그 달 실제 마지막 날을 사용하고, `월말`은 매달 실제 마지막 날을 사용합니다.
9. 전기요금은 아직 정책 모듈이 없으므로 실제/샘플 금액을 표시하지 않습니다.
10. Playwright는 API와 GIS를 deterministic하게 mock해 auth 미설정/signed-out 로그인, owner quick write+reload, viewer read-only, 첫 meter 생성, API 실패, 월말 설정, 모바일 폭과 keyboard 흐름을 보호합니다.
11. 실제 Provider credential, remote D1, production secret, 실사용자 데이터, sharing invitation, PWA/offline write, tariff는 이번 범위에 넣지 않았습니다.

## 다음 1순위: preview 환경의 실제 Cloudflare D1 + Google Provider 연결 및 실사용자 E2E

repository 코드가 아니라 Cloudflare/Google 환경 상태와 credential이 실제 결과를 바꾸는 단계입니다.

완료 조건:

1. 현재 Cloudflare 공식 방식과 무료 한도를 다시 확인한 뒤 preview 전용 D1 resource/binding을 연결합니다.
2. Google OAuth/GIS Client ID를 현재 preview origin에 맞게 설정하고 `GOOGLE_CLIENT_ID`, 강한 `SESSION_SECRET`, TTL을 repository 밖 환경값으로 주입합니다.
3. 실제 Google 로그인 → first user 생성 → first meter 생성 → reading 저장 → 새로고침 후 동일 raw reading/계산 복원까지 preview에서 검증합니다.
4. 두 번째 테스트 사용자가 없다면 sharing 권한 검증을 억지로 포함하지 않습니다. 별도 사용자로 검증할 수 있을 때 owner/viewer 격리를 확인합니다.
5. Secret, cookie, 실제 user row/reading을 commit/log에 노출하지 않습니다.
6. preview 검증이 끝나도 `main`, VERSION, tag, Release, production deploy는 사용자 승인 없이 변경하지 않습니다.

## 그 이후 후보

- PWA installability; offline write/background sync는 실제 필요 확인 전 보류
- version/effective date와 공식 출처 provenance를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유 초대/해제 UI와 관리 API

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
