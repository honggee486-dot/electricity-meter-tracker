# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 구간 계산 baseline

- [x] Vite + TypeScript + 기본 DOM/CSS 선택, 런타임 프레임워크 없음
- [x] Workers Static Assets 개발 preview 및 `work/*` 자동 preview 경로 확인
- [x] UI / usage / tariff / API / auth / persistence 최소 책임 경계 정리
- [x] Google subject ↔ 내부 user_id, 서버 권한, owner/viewer 방향 정리
- [x] 홈 즉시 입력, 자동 시각과 임시 체험 기록, 기록/분석/설정/공유 준비 UI
- [x] 누적 kWh 문자열 → 정확한 정수 Wh 변환 계약
- [x] 절대 epoch-millisecond instant 기반 reading 계약
- [x] 두 reading의 사용량, 경과시간, 평균 소비전력 순수 계산
- [x] 감소 누적값, 동일값, 동일/역전 시각, 소수값, 날짜 경계에 대한 domain 자동 테스트
- [x] UTC / Asia-Seoul에서 동일한 구간 계산 계약 검증 경로
- [x] build + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain 결과와 연결하지 않습니다. API/DB/auth도 아직 없습니다.

## 완료 WorkUnit: 순수 사용량 구간 domain + 자동 테스트

현재 내부 baseline:

1. 누적값은 부호 없는 decimal kWh 문자열을 최대 3자리 소수까지 받아 정수 Wh로 변환한다. 이 1 Wh 정밀도는 persistence/API가 생기기 전의 가역적인 내부 계약이며 실제 계량기 제품 범위를 의미하지 않는다.
2. 측정 시각은 `measuredAtMs` Unix epoch milliseconds 절대 instant다. calendar timezone은 다음 단계에서 별도로 적용한다.
3. 같은 누적값의 후속 기록은 0 Wh 구간으로 허용한다.
4. 감소 누적값은 meter reset/replacement로 임의 해석하지 않고 오류로 처리한다.
5. 동일 또는 역전 measuredAt은 오류로 처리한다.
6. 구간 결과는 exact `usageWh`, `usageKwh`, elapsed ms/hours, 평균 소비전력 W를 제공한다.

## 다음 1순위 WorkUnit: 날짜 경계 분할/보간 + provenance

임의 시점 기록 사이의 한 구간을 계량기 timezone의 일자 경계로 나누고, 실제 측정값과 보간값의 의미를 분리합니다.

완료 조건:

1. calendar 계산이 명시적인 meter timezone을 입력으로 받고 서버 로컬 timezone에 의존하지 않는다.
2. 같은 날 구간, 자정 통과, 여러 날짜 통과, 월말/연말/윤년 경계를 처리한다.
3. 실제 reading 두 점 사이를 시간 비례 선형 보간해 각 날짜 경계의 누적값/사용량을 계산하고 전체 구간 사용량 보존 invariant를 테스트한다.
4. 실제 측정값과 보간 경계값에 `actual / interpolated` provenance를 유지한다.
5. 정확히 경계에 실제 reading이 존재하면 실제값이 보간값보다 우선한다.
6. 순수 TypeScript domain과 자동 테스트로 끝내며 UI/API/D1 연결로 범위를 넓히지 않는다.
7. 날짜/timezone 라이브러리는 native API로 correctness를 확보하기 어려운 실제 근거가 있을 때만 추가한다.

## 그 이후 후보

- 검침주기 및 검침 경계 보간: 29~31일이 없는 달의 정책은 구현 전에 Discussion Gate
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
