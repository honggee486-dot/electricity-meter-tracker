# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 domain + Worker API shell baseline

- [x] Vite + TypeScript + 기본 DOM/CSS 선택, 런타임 프레임워크 없음
- [x] Workers Static Assets 개발 preview 및 `work/*` 자동 preview 경로 확인
- [x] UI / usage / tariff / API / auth / persistence 최소 책임 경계 정리
- [x] Google subject ↔ 내부 user_id, 서버 권한, owner/viewer 방향 정리
- [x] 홈 즉시 입력, 자동 시각과 임시 체험 기록, 기록/분석/설정/공유 준비 UI
- [x] 누적 kWh 문자열 → 정확한 정수 Wh 변환 계약
- [x] 절대 epoch-millisecond instant 기반 reading 계약
- [x] 두 reading의 사용량, 경과시간, 평균 소비전력 순수 계산
- [x] 명시적 meter timezone 기준 일자별 사용량 분할과 선형 보간
- [x] `actual / interpolated` provenance 및 총사용량 보존 invariant
- [x] 검침 마감 설정 `1~31일` + 별도 `월말` 의미 계약
- [x] 고정 일자가 없는 달은 해당 월 마지막 날로 자동 보정
- [x] 이전/현재/다음 검침주기와 남은 기간 계산
- [x] 검침 경계 actual 우선, 전후 reading 보간, 자료 부족 시 미산출 계약
- [x] 최신 측정 구간 / 최근 완전 일자 평균 / 현재 주기 평균 분리
- [x] 현재 주기 pace 기반 마감 예상과 비교용 30일 환산 분리
- [x] 이전 검침주기 사용량과 현재 예상량 비교 계약
- [x] 관측 비율·최근 완전 일자 수·경계 provenance·최신 구간 길이 기반 confidence evidence
- [x] 자료 부족/주기 첫 instant에서 예상값 미산출
- [x] 월말/연말/윤년/DST 및 UTC / Asia-Seoul process timezone 자동 검증 경로
- [x] 동일-origin Worker module entry + `/api/health` deterministic route
- [x] `/api/*` selective Worker-first routing으로 기존 static asset fast path 유지
- [x] JSON API 404/405 error envelope와 no-store 응답 baseline
- [x] build + Worker API + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain/API 결과와 연결하지 않습니다. D1/auth/실제 CRUD도 아직 없습니다.

## 완료 WorkUnit: Worker runtime + 최소 API shell

현재 baseline:

1. `src/worker.ts`가 Cloudflare Worker module entry와 현재 API request owner다.
2. `GET /api/health`는 외부 상태나 시각에 의존하지 않는 `{ "ok": true }` JSON을 반환하고 cache를 금지한다.
3. 같은 health route의 다른 method는 `405 METHOD_NOT_ALLOWED`와 `Allow: GET`을 반환한다.
4. 등록되지 않은 `/api` 경로는 공통 `{ error: { code, message } }` envelope의 404를 반환한다.
5. `wrangler.jsonc`는 `main`을 Worker entry에 연결하고 `assets.run_worker_first`를 `/api/*`에만 적용한다. 정적 asset 요청은 기본 asset-first 경로를 유지한다.
6. pure usage/calendar/billing/forecast domain은 Worker `Request`/`Response`나 binding을 import하지 않는다.
7. Worker API 테스트는 별도 임시 compile output `.worker-test/`에서 Node 내장 test runner로 실행한다.
8. Google auth, D1 binding/schema, 실제 meter/readings CRUD, UI 연결은 아직 구현하지 않는다.
9. 2026-09-08 Cloudflare 공식 문서 기준 Workers Free는 100,000 Worker requests/day, HTTP request당 10 ms CPU이며 Static Assets 요청은 무료·무제한이다. 실제 비용/한도 결정 시 다시 확인한다.

## 다음 1순위 WorkUnit: D1 persistence schema + migration baseline

현재 domain/API shell 위에 실제 사용자 데이터를 저장할 최소 D1 구조를 추가합니다. Google 로그인과 CRUD authorization을 한 번에 묶지 않습니다.

완료 조건:

1. 구현 시점의 Cloudflare D1 공식 문서와 현재 Free 한도/제약을 다시 확인한다.
2. `users`, `meters`, `readings`, `meter_members` 후보를 현재 identity/owner-viewer/domain 계약과 대조해 최소 schema로 확정한다.
3. provider email을 불변 사용자 ID로 사용하지 않고 내부 `user_id`와 향후 Google stable subject 연결을 허용한다.
4. meter별 name / timezone / billing close setting을 보존하고 reading은 meter / measured instant / cumulative value 원본 의미를 보존한다.
5. 파생 usage/forecast 값을 불필요하게 저장하지 않는다.
6. foreign key/index/uniqueness가 사용자 데이터 분리와 주요 조회 패턴을 보호하도록 최소 migration을 만든다.
7. migration/schema 검증 경로를 추가하되 실제 사용자 데이터나 production D1을 변경하지 않는다.
8. Google OAuth/session, authorization CRUD, UI 연결, production deploy는 아직 구현하지 않는다.

## 그 이후 후보

- Google 로그인, 내부 user identity, session
- server-side ownership/authorization + meter/readings CRUD
- 실제 모바일 UI와 API/domain 연결
- 검침 마감 설정 UI: 1~31일 + 월말 선택
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
