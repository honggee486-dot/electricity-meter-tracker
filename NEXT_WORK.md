# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 domain + Worker API shell + D1 persistence/runtime baseline

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
- [x] `migrations/0001_initial.sql` D1 persistence schema baseline
- [x] 내부 `user_id`와 unique Google subject 분리
- [x] meter owner / name / timezone / `day|month-end` 검침 설정 보존
- [x] reading 원본 `meter / measured_at_ms / cumulative_wh` 보존 및 동일 meter·동일 instant 중복 차단
- [x] owner는 `meters.owner_user_id`, 공유 viewer는 `meter_members`로 단순 분리
- [x] 주요 owner/member/reading 조회용 최소 index와 foreign key/cascade 계약
- [x] `src/persistence/d1.ts` D1-compatible persistence read owner
- [x] Google subject / owner meter / viewer meter / ordered reading parameterized lookup
- [x] DB row → persistence/domain 입력 경계 검증과 malformed row explicit failure
- [x] `EXPLAIN QUERY PLAN`으로 4개 read path의 기존 index 사용 회귀 보호
- [x] local-only Wrangler D1 config + synthetic fixture + gated Worker probe
- [x] pinned Wrangler `4.129.0` + workerd + local D1 migration/fixture/HTTP round trip CI 검증
- [x] root product Wrangler config에서 local probe가 계속 API 404인 isolation 검증
- [x] build + persistence + local D1/workerd + Worker API + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain/API/D1 결과와 연결하지 않습니다. 실제 remote D1 database/binding, auth, mutation CRUD도 아직 없습니다.

## 완료 WorkUnit: D1 persistence query owner + local runtime verification

현재 baseline:

1. `src/persistence/d1.ts`가 현재 D1 query owner이며 `src/domain/*`는 D1/SQL을 import하지 않는다.
2. dynamic query 값은 prepared statement의 `?1` binding을 사용하고 SQL 문자열 결합으로 삽입하지 않는다.
3. `findUserByGoogleSubject`는 unique Google subject → 내부 user row를 조회한다.
4. `listOwnedMeters`, `listViewerMeterIds`, `listMeterReadings`는 기존 owner/member/reading index와 같은 access path를 사용하고 deterministic ordering을 갖는다.
5. DB row의 문자열/safe integer/검침 마감 의미를 호출자에게 넘기기 전에 검증하고 손상 row는 `PersistenceDataError`로 실패한다.
6. `persistence-tests/schema_test.py`는 schema integrity와 4개 persistence read path의 index 사용을 `EXPLAIN QUERY PLAN`으로 확인한다. `?1` plan 검증도 Python의 향후 named-binding 규칙에 맞는 mapping으로 실행한다.
7. `worker-tests/persistence.test.mjs`는 parameter binding, row mapping, ordering, malformed row failure를 가짜 D1 binding으로 검증한다.
8. `wrangler.local.jsonc`는 root deploy config와 분리된 local D1/workerd 전용 설정이며 synthetic ID만 사용한다.
9. `persistence-tests/local_fixture.sql`은 local probe 전용 synthetic owner/viewer/meter/readings fixture다.
10. `/api/_dev/persistence-check`는 `LOCAL_PERSISTENCE_CHECK=1`과 DB binding이 동시에 있을 때만 동작한다. root production/preview config에서는 일반 404 API route로 남는다.
11. `persistence-tests/local_runtime_check.sh`는 Wrangler `4.129.0`을 고정해 migration → fixture write → workerd Worker → D1 prepared read → HTTP 응답을 동일 local persistence state에서 검증한다.
12. GitHub Actions Linux runner에서 local probe가 `ok: true`, `local-owner`, owner/viewer의 `local-meter`, `[1000, 2000]` ordered reading instant를 반환하는 실제 Wrangler/workerd/D1 round trip을 확인한다.
13. 같은 runtime harness가 root `wrangler.jsonc`로 별도 Worker를 실행해 `/api/_dev/persistence-check`가 `404 NOT_FOUND`로 유지되는 것도 확인한다.
14. 실제 Cloudflare remote D1 database 생성, production/preview binding, 실제 사용자 데이터, Google OAuth/session, mutation CRUD는 추가하지 않았다.
15. Windows-specific filesystem/process 동작은 현재 persistence call path의 필수 계약이 아니며, 별도 OS 고유 증상이 생기기 전에는 중복 runtime 검증을 요구하지 않는다.

## 다음 1순위 WorkUnit: Google 로그인 + 내부 identity/session baseline

현재 persistence와 Worker 경계 위에 Google 로그인만 추가하되 meter/readings authorization CRUD와 UI 전체 연결을 한 번에 묶지 않습니다.

완료 조건:

1. 구현 시점의 Google OAuth/OIDC와 Cloudflare Workers 공식 지원 방식, 보안 요구, 무료 운영 가능성을 다시 확인한다.
2. 자체 이메일/비밀번호 회원가입은 추가하지 않고 Google 로그인만 지원한다.
3. 공급자의 안정적 subject identifier와 내부 `user_id`를 연결하며 email을 불변 identity key로 사용하지 않는다.
4. 최초 정상 Google 로그인 시 필요한 내부 user row를 자동 생성할 수 있는 최소 persistence write 경계를 둔다.
5. OAuth state/nonce/PKCE 또는 선택한 공식 flow가 요구하는 CSRF/replay 방어와 redirect 검증을 서버 경계에서 강제한다.
6. session은 브라우저 JavaScript가 읽을 필요가 없는 secure cookie 기반을 우선 검토하고, signing/encryption secret과 OAuth credential은 저장소에 넣지 않는다.
7. auth가 없는 요청과 유효하지 않은 session은 결정적으로 거부하되 meter별 owner/viewer authorization 정책은 다음 WorkUnit에서 별도로 구현한다.
8. 실제 OAuth credential, production secret, production deploy, 실제 사용자 데이터는 사용자 승인 없이 만들거나 저장소에 넣지 않는다.
9. 공식 경로를 확인한 뒤에도 동급 구현 선택지가 장기 security/state ownership을 갈라놓으면 구현 전에 Discussion Gate를 연다.

## 그 이후 후보

- server-side ownership/authorization + meter/readings CRUD
- 실제 모바일 UI와 API/domain 연결
- 검침 마감 설정 UI: 1~31일 + 월말 선택
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유 UI/관리

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
