# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 domain + Worker API + D1 persistence/runtime + Google identity/session + owner/viewer CRUD API

- [x] Vite + TypeScript + 기본 DOM/CSS 선택, 런타임 프레임워크 없음
- [x] Workers Static Assets 개발 preview 및 `work/*` 자동 preview 경로 확인
- [x] UI / usage / tariff / API / auth / persistence 최소 책임 경계 정리
- [x] 홈 즉시 입력, 자동 시각과 임시 체험 기록, 기록/분석/설정/공유 준비 UI
- [x] 누적 kWh 문자열 → 정확한 정수 Wh 변환, 절대 epoch-millisecond reading 계약
- [x] 구간 사용량·경과시간·평균 소비전력, 일자별 분할/보간과 `actual / interpolated` provenance
- [x] 검침 마감 `1~31일 + 월말`, 월말 자동 보정, 이전/현재/다음 검침주기와 경계 보간
- [x] 최근 구간/최근 완전 일자/주기 평균, 마감 예상, 30일 환산, 이전 주기 비교와 confidence evidence
- [x] 월말/연말/윤년/DST 및 UTC / Asia-Seoul process timezone 자동 검증
- [x] 동일-origin Worker module entry + `/api/health` + JSON API error baseline
- [x] `users / meters / meter_members / readings` D1 schema/migration과 최소 index/FK/cascade 계약
- [x] Google subject / 내부 user ID / owner/viewer meter / ordered reading D1 persistence owner
- [x] first-login `INSERT OR IGNORE` + 재조회로 Google subject → 내부 user 자동 생성과 동시성 winner 재사용
- [x] local-only Wrangler D1 migration/fixture/workerd HTTP round trip 및 product-config dev probe isolation
- [x] Google GIS ID token RS256/JWK 서명 + issuer/audience/expiry/subject 검증
- [x] GIS `g_csrf_token` cookie/body double-submit 검증과 form body/content-type 제한
- [x] `__Host-em_session` HMAC-SHA256 서명 세션, `Secure; HttpOnly; SameSite=Lax`, env 기반 TTL/secret 검증
- [x] `/api/auth/config`, `/api/auth/google`, `/api/auth/session`, `/api/auth/logout` 서버 auth baseline
- [x] 모든 meter/readings product route에서 내부 session을 먼저 검증하고 owner/viewer 권한을 서버에서 강제
- [x] owner meter 생성/조회/설정 수정/삭제, viewer 공유 meter 조회, 비회원·공유 해제 접근 차단
- [x] owner reading 조회/생성/수정/삭제, viewer 읽기 전용, 동일 measured instant와 누적값 역행 방지
- [x] meter timezone과 `1~31일 + 월말` 설정을 기존 domain 계약으로 API 입력 검증
- [x] client가 `ownerUserId`, `meterId`, `readingId`를 body로 주입해 ownership을 바꾸지 못하도록 exact body contract 적용
- [x] authorized CRUD query를 D1 prepared binding owner에 유지하고 기존 index 재사용 query-plan 검증
- [x] local workerd에서 synthetic owner/viewer/outsider session으로 실제 D1 authorized CRUD HTTP round trip
- [x] `.dev.vars` / `.env` 계열 Secret 파일 Git 제외
- [x] build + persistence + local D1/workerd + Worker/auth/resource API + domain + Playwright GitHub Actions verify

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 auth/API/D1/domain 결과와 연결하지 않습니다. 실제 Cloudflare remote D1 database/binding, Google Client ID/SESSION_SECRET 설정, 실제 Google Provider 로그인도 아직 없습니다.

## 완료 WorkUnit: server-side ownership/authorization + meter/readings CRUD

현재 baseline:

1. `/api/meters*` product route는 모두 유효한 `__Host-em_session`을 먼저 검증하고 해당 내부 user가 D1에 존재해야 실행한다.
2. `GET /api/meters`는 로그인 user가 owner인 meter와 명시적으로 공유받은 viewer meter만 반환하고 각 항목에 `owner / viewer` 역할을 표시한다.
3. `GET /api/meters/:meterId`와 reading 조회는 owner/viewer 모두 허용한다. 공유받지 않은 user와 존재하지 않는 meter는 동일한 404 응답으로 처리해 resource 존재 여부를 노출하지 않는다.
4. viewer가 이미 접근 가능한 meter에 mutation을 시도하면 403으로 거부한다. owner만 meter 설정 변경·삭제와 reading 생성·수정·삭제가 가능하다.
5. meter 생성 시 `owner_user_id`와 meter UUID는 서버가 session/random UUID에서 결정한다. body는 `name`, `timezone`, `billingClose`만 허용하므로 client-side owner ID 변조를 받지 않는다.
6. meter 설정은 IANA timezone과 기존 `BillingCloseSetting` 의미를 재사용한다. `day`는 1~31, `month-end`는 별도 설정이며 실제 달에 날짜가 없으면 기존 domain이 월말로 자동 보정한다.
7. reading mutation body는 `measuredAtMs`와 decimal `cumulativeKwh`만 허용한다. 기존 usage domain으로 정확한 integer Wh로 변환하고 ECMAScript Date 범위의 epoch millisecond instant를 검증한다.
8. reading 생성/수정은 같은 meter의 exact instant 중복을 409로 거부하고 직전/다음 reading과 `calculateUsageInterval` 계약을 적용해 누적값 역행을 거부한다. 동일 누적값은 기존 domain 계약대로 허용한다.
9. `src/persistence/d1.ts`가 access lookup, meter/readings mutation, neighbor lookup SQL을 소유하며 모든 동적 값은 prepared binding으로 전달한다. 파생 사용량/forecast는 저장하지 않는다.
10. meter 삭제는 기존 D1 FK cascade로 viewer grant와 raw readings를 정리한다. owner identity 자체는 삭제하지 않는다.
11. Node Worker/resource test는 owner/viewer/outsider, owner ID body injection, 공유 해제, invalid timezone/검침 설정, reading duplicate/decrease/update/delete를 보호한다.
12. Wrangler local runtime은 실제 D1/workerd에서 synthetic owner/viewer/outsider signed session으로 resource API를 왕복한다. 실제 사용자 데이터나 remote D1은 사용하지 않는다.
13. 실제 Google credential, production secret, remote D1 binding, sharing invitation UI, production deploy는 추가하지 않았다.

## 다음 1순위 WorkUnit: 모바일 UI와 auth/API/domain 연결 baseline

현재 demo UI를 한 번에 전부 재설계하지 않고, 이미 존재하는 화면과 서버 계약을 실제 데이터 흐름에 연결합니다.

완료 조건:

1. frontend API client는 `/api/auth/session`, `/api/meters`, 선택 meter의 `/readings`를 동일 origin으로 호출하고 SQL/DB 세부를 알지 않는다.
2. 인증되지 않은 상태, 인증 환경 미설정, 로그인 완료 상태를 UI에서 구분한다. 실제 Google Provider button/credential flow는 Client ID가 실제 환경에 구성된 경우에만 활성화한다.
3. 로그인 사용자는 owner/viewer meter 목록에서 현재 meter를 선택할 수 있고 viewer는 읽기 전용 UI로 표시한다.
4. owner의 홈 빠른 입력은 현재 시각 + 누적 kWh를 기존 POST reading API에 저장하고 성공 후 최신 raw readings를 다시 읽는다.
5. 화면 지표는 `src/demo.ts` 고정 숫자가 아니라 실제 raw readings + meter timezone/검침 설정을 기존 usage/daily/billing/forecast domain에 넣어 계산한다.
6. `1~31일 + 월말` meter 설정 UI는 owner에게만 활성화하고 저장 후 API의 canonical 설정을 다시 표시한다.
7. API error/loading/empty state를 모바일에서 명확히 표시하되 임의 localStorage/오프라인 write queue를 추가하지 않는다.
8. UI 테스트는 인증/owner/viewer/API 실패를 deterministic mock으로 보호하고 기존 iPhone Chromium/WebKit·desktop smoke를 유지한다.
9. 실제 remote D1 생성, Google Client ID/SESSION_SECRET 발급·등록, production deploy가 필요해지는 지점은 repository 코드와 분리해 사용자 권한/credential 단계로 넘긴다.

## 그 이후 후보

- 실제 Cloudflare D1 resource/binding + Google Provider preview 환경 연결 및 실사용자 E2E
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유 초대/해제 UI와 관리 API

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
