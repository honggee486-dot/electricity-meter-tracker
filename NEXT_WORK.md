# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 구간 + 일자별 계산 baseline

- [x] Vite + TypeScript + 기본 DOM/CSS 선택, 런타임 프레임워크 없음
- [x] Workers Static Assets 개발 preview 및 `work/*` 자동 preview 경로 확인
- [x] UI / usage / tariff / API / auth / persistence 최소 책임 경계 정리
- [x] Google subject ↔ 내부 user_id, 서버 권한, owner/viewer 방향 정리
- [x] 홈 즉시 입력, 자동 시각과 임시 체험 기록, 기록/분석/설정/공유 준비 UI
- [x] 누적 kWh 문자열 → 정확한 정수 Wh 변환 계약
- [x] 절대 epoch-millisecond instant 기반 reading 계약
- [x] 두 reading의 사용량, 경과시간, 평균 소비전력 순수 계산
- [x] 감소 누적값, 동일값, 동일/역전 시각, 소수값에 대한 domain 자동 테스트
- [x] 명시적 meter timezone 기준 같은 날/자정/여러 날의 일자별 사용량 분할
- [x] 시간비례 선형 보간과 `actual / interpolated` provenance
- [x] 월말/연말/윤년/DST 경계 및 총사용량 보존 invariant 자동 테스트
- [x] UTC / Asia-Seoul process timezone에서 동일한 domain 계약 검증 경로
- [x] build + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain 결과와 연결하지 않습니다. API/DB/auth도 아직 없습니다.

## 완료 WorkUnit: 순수 구간 + 날짜 경계 분할/보간

현재 내부 baseline:

1. 누적값은 부호 없는 decimal kWh 문자열을 최대 3자리 소수까지 받아 정수 Wh로 변환한다. 이 1 Wh 정밀도는 persistence/API가 생기기 전의 가역적인 내부 계약이며 실제 계량기 제품 범위를 의미하지 않는다.
2. 측정 시각은 `measuredAtMs` Unix epoch milliseconds 절대 instant다.
3. 같은 누적값의 후속 기록은 0 Wh 구간으로 허용한다.
4. 감소 누적값은 meter reset/replacement로 임의 해석하지 않고 오류로 처리한다.
5. 동일 또는 역전 measuredAt은 오류로 처리한다.
6. 구간 결과는 exact `usageWh`, `usageKwh`, elapsed ms/hours, 평균 소비전력 W를 제공한다.
7. `splitUsageIntervalByLocalDate`는 명시적 meter timezone의 local-date 경계를 찾아 한 구간을 일자별로 나눈다.
8. 실제 endpoint는 `actual`, 실제 reading 사이 날짜 경계는 `interpolated`이며 정확히 경계에 실제 reading이 있으면 actual이 우선한다.
9. 보간은 경과시간 비례 선형 보간이다. 보간 누적값은 fractional Wh가 될 수 있지만 원본 reading은 정수 Wh 계약을 유지한다.
10. calendar 경계는 서버/process local timezone이나 고정 24시간 가정에 의존하지 않고 IANA timezone을 사용한다.

## 다음 1순위 WorkUnit: 검침주기 + 검침 경계 보간

21일 마감처럼 meter별 검침 마감일을 calendar domain에 추가하고 실제 경계 reading → 전후 reading 보간 순서를 구현합니다.

**Discussion Gate:** 마감일을 29~31일로 설정했는데 해당 날짜가 없는 달의 정책은 제품 의미를 바꾸므로 구현 전에 사용자 결정을 받습니다.

정책 결정 후 완료 조건:

1. `21일 마감 → 전월 22일 00:00 ~ 당월 22일 00:00`의 half-open 계산 경계를 사용해 표시 기간 `전월 22일 ~ 당월 21일`과 일치시킨다.
2. 이전/현재/다음 검침주기와 현재 시점의 남은 기간을 meter timezone 기준으로 계산한다.
3. 검침 경계에 actual reading이 있으면 actual을 사용한다.
4. actual이 없고 경계 전후 reading이 충분하면 선형 보간하고 `interpolated` provenance를 유지한다.
5. 실제 마감 reading이 나중에 들어오면 추정/보간 경계보다 우선할 수 있는 순수 domain 계약을 만든다.
6. 월말/연말/윤년과 결정된 29~31일 정책을 자동 테스트한다.
7. UI/API/D1/요금 계산으로 범위를 넓히지 않는다.

## 그 이후 후보

- 최근 일평균 / 주기 평균 / 마감 예측 / 30일 환산 및 신뢰도
- Worker runtime + API shell
- users / meters / readings / meter_members D1 schema와 migration
- Google 로그인, 내부 user identity, session
- server-side ownership/authorization + meter/readings CRUD
- 실제 모바일 UI와 API/domain 연결
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
