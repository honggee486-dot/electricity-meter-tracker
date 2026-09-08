# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 usage + calendar + 검침주기 baseline

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
- [x] 월말/연말/윤년/DST 및 UTC / Asia-Seoul process timezone 자동 검증 경로
- [x] build + domain + Playwright를 보호하는 GitHub Actions verify workflow

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain 결과와 연결하지 않습니다. API/DB/auth도 아직 없습니다.

## 완료 WorkUnit: 검침 마감 설정 + 검침주기 + 경계 보간

현재 내부 baseline:

1. 검침 마감 설정은 `{ kind: 'day', day: 1..31 }` 또는 `{ kind: 'month-end' }`로 의미를 분리한다.
2. 고정 일자가 해당 월에 없으면 `min(설정 일자, 그 달 마지막 일자)`로 실제 마감일을 정한다. 예: 30일 설정의 평년 2월은 28일, 윤년 2월은 29일이다.
3. `month-end`는 설정 숫자 31과 별개 의미이며 매월 실제 마지막 일자를 사용한다.
4. 21일 마감의 계산 구간은 `전월 22일 00:00 <= t < 당월 22일 00:00`, 표시 기간은 `전월 22일 ~ 당월 21일`이다.
5. 현재 instant에서 이전/현재/다음 검침주기와 현재 주기 남은 시간을 meter timezone 기준으로 계산한다.
6. 검침 경계에 실제 reading이 있으면 `actual`을 사용하고, 없으면 가장 가까운 전후 actual reading으로 선형 보간해 `interpolated`를 만든다.
7. 경계를 감싸는 reading이 부족하면 값을 임의 추정하지 않고 `null`로 남긴다.
8. 나중에 정확한 경계 actual reading이 들어오면 같은 계산 호출에서 보간값보다 actual이 자동 우선한다.
9. calendar 계산은 공용 `src/domain/calendar.ts`가 IANA timezone/local-date 변환을 소유하며 고정 24시간을 가정하지 않는다.

## 다음 1순위 WorkUnit: 최근 일평균 / 주기 평균 / 마감 예상 / 30일 환산 + 신뢰도

현재 순수 usage/calendar/billing-cycle domain 위에 예측을 추가합니다.

완료 조건:

1. 최근 측정 구간 소비 속도, 최근 일평균, 현재 검침주기 평균을 서로 다른 값으로 유지한다.
2. 현재 검침주기 실제/보간 누적 사용량과 남은 기간을 이용해 마감일까지 예상 사용량을 계산한다.
3. 비교용 30일 환산량을 마감 예상량과 별도 필드로 제공한다.
4. 데이터가 짧거나 경계값을 만들 수 없을 때 과도한 예측을 하지 않고 신뢰도/자료 부족 상태를 명시한다.
5. 이전 검침주기 비교에 필요한 최소 순수 계산 계약을 만든다.
6. 테스트에서 검침기간 첫날/마지막 날, 짧은 측정 구간, 최근 사용 급변, 자료 부족을 보호한다.
7. UI/API/D1/요금 계산으로 범위를 넓히지 않는다.

## 그 이후 후보

- Worker runtime + API shell
- users / meters / readings / meter_members D1 schema와 migration
- Google 로그인, 내부 user identity, session
- server-side ownership/authorization + meter/readings CRUD
- 실제 모바일 UI와 API/domain 연결
- 검침 마감 설정 UI: 1~31일 + 월말 선택
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
