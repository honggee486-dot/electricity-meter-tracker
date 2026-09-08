# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 domain + Worker API shell + D1 schema + persistence query owner baseline

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
- [x] build + persistence + Worker API + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain/API/D1 결과와 연결하지 않습니다. 실제 remote D1 database/binding, auth, mutation CRUD도 아직 없습니다.

## 완료 WorkUnit: D1 persistence query owner implementation

현재 baseline:

1. `src/persistence/d1.ts`가 현재 D1 query owner이며 `src/domain/*`는 D1/SQL을 import하지 않는다.
2. dynamic query 값은 prepared statement의 `?1` binding을 사용하고 SQL 문자열 결합으로 삽입하지 않는다.
3. `findUserByGoogleSubject`는 unique Google subject → 내부 user row를 조회한다.
4. `listOwnedMeters`, `listViewerMeterIds`, `listMeterReadings`는 기존 owner/member/reading index와 같은 access path를 사용하고 deterministic ordering을 갖는다.
5. DB row의 문자열/safe integer/검침 마감 의미를 호출자에게 넘기기 전에 검증하고 손상 row는 `PersistenceDataError`로 실패한다.
6. `persistence-tests/schema_test.py`는 schema integrity뿐 아니라 identity/owner/viewer/reading query가 선언된 index를 사용하는지 `EXPLAIN QUERY PLAN`으로 확인한다.
7. `worker-tests/persistence.test.mjs`는 parameter binding, row mapping, ordering, malformed row failure를 가짜 D1 binding으로 검증한다.
8. `wrangler.local.jsonc`는 root deploy config와 분리된 local D1/workerd 전용 설정이며 synthetic ID만 사용한다.
9. `persistence-tests/local_fixture.sql`은 local probe 전용 synthetic owner/viewer/meter/readings fixture다.
10. `/api/_dev/persistence-check`는 `LOCAL_PERSISTENCE_CHECK=1`과 DB binding이 동시에 있을 때만 동작한다. root production/preview config에서는 일반 404 API route로 남는다.
11. 실제 Cloudflare D1 database 생성, production/preview binding, 실제 사용자 데이터, Google OAuth/session, mutation CRUD는 추가하지 않았다.
12. Web-side TypeScript/Node/SQLite와 GitHub Actions 검증은 가능하지만 실제 `wrangler` local workerd + D1 binding round trip은 로컬 runtime evidence가 필요하다.

## 다음 1순위 검증: local D1/workerd round trip

새 기능 설계가 아니라 위 구현의 실제 Cloudflare local runtime 호환성을 확인합니다.

완료 조건:

1. 최신 work HEAD에서 `AGENTS.md` Git 규칙을 지키고 Wrangler의 local mode만 사용한다.
2. `wrangler.local.jsonc`로 local D1 migration을 적용한다. remote D1 명령이나 배포는 실행하지 않는다.
3. `persistence-tests/local_fixture.sql`을 local D1에 적용해 write round trip을 만든다.
4. local Worker를 실행하고 `GET /api/_dev/persistence-check`가 `ok: true`, owner/viewer meter와 `[1000, 2000]` ordered reading instant를 반환하는지 확인한다.
5. root `wrangler.jsonc` product route에서는 local gate가 활성화되지 않는 계약을 유지한다.
6. Windows/Node/Wrangler/runtime 결함이 확인될 때만 직접 관련 최소 수정 후 targeted/full 검증과 work branch non-force commit/push를 수행한다.

## 그 이후 후보

- Google 로그인, 내부 user identity, session
- server-side ownership/authorization + meter/readings CRUD
- 실제 모바일 UI와 API/domain 연결
- 검침 마감 설정 UI: 1~31일 + 월말 선택
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유 UI/관리

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
