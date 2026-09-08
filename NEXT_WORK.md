# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 usage + calendar + 검침주기 + forecast baseline

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
- [x] build + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain 결과와 연결하지 않습니다. API/DB/auth도 아직 없습니다.

## 완료 WorkUnit: forecast / 비교 / confidence evidence

현재 내부 baseline:

1. `calculateUsageForecast`는 reading을 시간순으로 정규화하고 최신 actual reading 시점을 forecast 기준점으로 사용한다.
2. 최근 측정 구간 pace, 최근 일평균, 현재 검침주기 평균은 서로 다른 값으로 유지한다.
3. 최근 일평균은 완전히 관측된 meter-local calendar day만 사용하며 window 일수는 caller가 양의 정수로 명시한다. 현재 domain에 숨은 `7일` 정책은 없다.
4. 현재 주기 사용량은 resolved cycle-start boundary와 최신 actual reading의 차이로 계산한다. 시작 경계를 만들 수 없으면 주기 평균/마감 예상/30일 환산을 만들지 않는다.
5. 마감 예상은 현재 주기 관측 평균 소비율을 실제 cycle duration에 적용한다. DST가 있는 timezone도 고정 24시간짜리 검침주기로 가정하지 않는다.
6. 비교용 30일 환산은 같은 관측 평균 소비율을 정확히 30×24시간에 적용하며 마감 예상량과 별도 필드다.
7. 이전 검침주기 경계를 충분히 만들 수 있으면 이전 실제/보간 주기 사용량과 현재 마감 예상의 delta/percent를 제공한다. 이전 사용량이 0이면 percent는 미산출한다.
8. 신뢰도는 임의 `low/medium/high` 등급을 만들지 않고 관측 주기 비율, 최근 완전 일자 수, cycle-start provenance, 최신 구간 elapsed, 이전 주기 availability를 evidence로 제공한다.
9. 검침주기 첫 instant, cycle-start 자료 부족, empty readings에서는 예상값을 억지 생성하지 않는다.
10. UI/API/D1/요금 계산은 아직 연결하지 않는다.

## 다음 1순위 WorkUnit: Worker runtime + 최소 API shell

현재 pure domain을 Cloudflare Worker의 동일-origin `/api` 경계에서 호출할 최소 runtime을 만듭니다. 실제 인증/D1 CRUD를 한 번에 묶지 않습니다.

완료 조건:

1. 구현 시점의 Cloudflare Workers 공식 문서와 현재 Free 한도/제약을 다시 확인한다.
2. static assets 동작을 유지하면서 최소 Worker entry와 `/api/health` 같은 deterministic route를 추가한다.
3. domain 모듈은 Worker binding/Request/Response에 의존하지 않고 현재 순수 owner를 유지한다.
4. API 입력 검증/error response의 최소 owner를 정하되 Google auth/D1 schema를 선행 구현하지 않는다.
5. 기존 Cloudflare dev preview와 GitHub Actions build/domain/UI 검증을 깨지 않는다.
6. production deploy, VERSION/tag/release/main 통합은 하지 않는다.

## 그 이후 후보

- users / meters / readings / meter_members D1 schema와 migration
- Google 로그인, 내부 user identity, session
- server-side ownership/authorization + meter/readings CRUD
- 실제 모바일 UI와 API/domain 연결
- 검침 마감 설정 UI: 1~31일 + 월말 선택
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
