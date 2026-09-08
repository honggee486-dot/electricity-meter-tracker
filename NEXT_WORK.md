# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 domain + Worker API shell + D1 schema baseline

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
- [x] SQLite in-memory migration contract test를 CI에 추가
- [x] build + persistence + Worker API + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain/API/D1 결과와 연결하지 않습니다. 실제 D1 binding/database, auth, CRUD도 아직 없습니다.

## 완료 WorkUnit: D1 persistence schema + migration baseline

현재 baseline:

1. `migrations/0001_initial.sql`이 현재 persistence schema의 단일 초기 migration이다.
2. `users.user_id`는 내부 식별자이고 `google_subject`는 별도 unique provider identity다. 이메일은 identity key로 저장하지 않는다.
3. `meters.owner_user_id`가 정확한 owner의 canonical source다. owner 삭제는 참조 meter가 남아 있는 동안 foreign key로 차단한다.
4. `meter_members`는 명시적으로 공유한 viewer grant만 보존한다. 같은 meter/user 중복 grant는 primary key로 차단한다.
5. meter는 `name`, IANA timezone 문자열, `billing_close_kind`, `billing_close_day`를 저장한다. `day`는 1~31이 필수이고 `month-end`는 day가 `NULL`이어야 한다.
6. `readings`는 `reading_id`, `meter_id`, `measured_at_ms`, `cumulative_wh`, `created_at_ms`만 저장한다. 일별 사용량·보간값·forecast·요금 같은 파생값은 저장하지 않는다.
7. 같은 meter의 정확히 같은 measured instant는 unique index로 차단하지만 같은 누적값을 더 늦은 시각에 다시 기록하는 것은 허용한다. 누적값 역행 검사는 현재 domain/API owner가 담당한다.
8. meter 삭제는 해당 viewer grant와 reading을 cascade 삭제하지만 user 자체는 삭제하지 않는다.
9. owner별 meter, user별 shared meter, meter별 측정시각 조회를 위한 최소 index만 둬 read amplification을 줄이고 불필요한 index write는 피한다.
10. `persistence-tests/schema_test.py`는 Python 표준 `sqlite3` in-memory DB에 migration을 적용해 table/index/FK/uniqueness/check/cascade 계약을 검증한다. 앱 runtime에는 Python dependency가 없다.
11. 2026-09-08 Cloudflare 공식 문서 기준 D1 Workers Free는 5,000,000 rows read/day, 100,000 rows written/day, 계정 총 5 GB, database당 500 MB, account당 10 databases이며 Free 한도 초과 시 query가 실패하고 자동 유료 과금으로 전환되지 않는다.
12. 실제 Cloudflare D1 database/binding은 아직 만들거나 연결하지 않았고 production data/migration은 변경하지 않았다.

## 다음 1순위 WorkUnit: D1 binding + 최소 persistence query owner

현재 schema를 실제 Worker persistence 경계에 연결하되 Google auth와 전체 CRUD를 한 번에 묶지 않습니다.

완료 조건:

1. 구현 시점의 Cloudflare D1 binding/local-development 공식 문서와 현재 Free 한도/제약을 다시 확인한다.
2. 실제 remote D1 resource 생성이나 production binding/deploy가 필요하면 사용자 승인 없이 실행하지 않는다. 먼저 local/preview 경로를 우선한다.
3. `src/domain/*`는 D1/SQL을 import하지 않고 순수 owner를 유지한다.
4. 최소 persistence module이 parameterized query와 row↔domain 입력 경계를 소유하도록 한다.
5. owner meter lookup, viewer membership lookup, meter readings ordered lookup에 현재 index가 실제로 맞는지 query plan/통합 테스트로 확인한다.
6. migration을 local D1-compatible runtime에서 적용하고 최소 read/write round trip을 검증한다.
7. 실제 사용자 데이터, Google OAuth/session, authorization CRUD, UI 연결, tariff, production deploy로 범위를 넓히지 않는다.

## 그 이후 후보

- Google 로그인, 내부 user identity, session
- server-side ownership/authorization + meter/readings CRUD
- 실제 모바일 UI와 API/domain 연결
- 검침 마감 설정 UI: 1~31일 + 월말 선택
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유 UI/관리

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
