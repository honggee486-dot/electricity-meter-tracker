# Gas meter product direction

확정일: **2026-09-09**

이 문서는 현재 전기 중심 구현을 같은 앱 안의 **전기 / 가스** 계량기 제품으로 확장할 때의 제품·데이터·도메인 계약을 고정한다. 현재 runtime은 아직 전기만 지원하며, 이 문서는 이후 구현이 전기 전용 명명과 단위를 무리하게 재사용하지 않도록 하는 설계 기준이다.

## 1. 제품 명칭과 UX 계약

사용자에게 노출하는 상위 utility 명칭은 다음 두 개만 사용한다.

```text
[ 전기 ] [ 가스 ]
```

- 가스 기능의 사용자-facing 명칭은 **`가스`**로 통일한다.
- 가스 원본 기록은 도시가스 계량기에 표시되는 누적 지침을 대상으로 한다.
- 가스 계량기 값은 가스의 최종 사용처를 분리해서 측정한 값으로 해석하지 않는다.
- repository 이름 `electricity-meter-tracker`, 기존 Cloudflare/D1 resource 이름, 기존 production 준비 자산은 이 기능 때문에 즉시 rename하지 않는다. 실제 public branding 변경이 필요해질 때 별도 Discussion Gate에서 판단한다.

### 화면 구조

기존 하단 `홈 / 기록 / 분석 / 설정` 탐색은 유지하고, ready product UI의 상위에 utility switch를 둔다.

```text
[ 전기 ] [ 가스 ]

계량기: [ 현재 utility의 계량기 ▼ ]

홈 / 기록 / 분석 / 설정
```

- utility switch는 meter selector보다 상위 개념이다.
- 각 utility 안에서 사용자가 여러 meter를 가질 수 있으므로 기존 meter selector는 계속 유지한다.
- 선택한 utility에 meter가 없으면 다른 utility의 meter를 섞어 보여주지 않고 `가스 계량기 추가` 같은 독립 empty state를 보여준다.
- 현재 전기 runtime만 존재하는 동안은 동작하지 않는 가짜 `가스` 탭을 먼저 노출하지 않는다. schema/API/domain 지원과 함께 같은 WorkUnit에서 실제 탭을 연다.

### 가스 홈의 첫 목표

전기와 같은 정보 위계를 유지하되 단위와 의미를 가스에 맞춘다.

- 현재 계량기 누적값: `m³`
- 직전 기록 이후 사용량: `m³`
- 직전 기록 이후 경과시간
- 해당 구간 시간당 사용량: `m³/h`
- 현재 검침주기 누적: `m³`
- 최근 완전 일평균: `m³/일`
- 마감 예상 사용량: `m³`
- 비교용 30일 환산량: `m³`
- 이전 검침주기 비교
- 예상 가스요금: provider/지역/effective tariff 근거가 있을 때만 표시

전기의 `평균 소비전력 W/kW`는 전기 전용 파생값이다. 가스 화면에서 억지로 같은 필드를 재사용하지 않고 `시간당 사용량 m³/h`를 사용한다.

## 2. 현재 구현에서 확인된 전기 전용 결합

2026-09-09 `work/0.1.0` 기준으로 다음 계약이 전기 단위에 직접 결합되어 있다.

1. `migrations/0001_initial.sql`
   - `readings.cumulative_wh`
2. `src/api.ts`
   - `ReadingResource.cumulativeWh`
   - `ReadingInput.cumulativeKwh`
3. `src/domain/usage.ts` 및 이를 소비하는 daily/billing/forecast
   - `MeterReadingPoint.cumulativeWh`
   - `usageWh`, `usageKwh`, `averagePowerW`
4. `src/main.ts`
   - 입력/기록/분석의 `kWh`, `W`, `예상 전기요금` 고정 표시
5. `src/domain/tariff.ts`
   - 주택용 전기 tariff 전용 policy

이 결합을 그대로 둔 채 gas 값을 `Wh` 필드에 넣는 방식은 금지한다. 숫자가 계산되더라도 코드·DB 의미가 거짓이 되어 이후 tariff, migration, debugging 비용을 키운다.

## 3. 권장 persistence migration

### meter type

meter에 명시적인 utility kind를 추가한다.

```text
utilityKind = electricity | gas
```

- 기존 meter는 migration 시 모두 `electricity`로 backfill한다.
- utility kind는 meter 생성 시 결정하고 **in-place 변경 불가**로 한다.
- 종류를 바꾸면 과거 누적값의 단위 의미가 달라지므로 settings update API로 수정할 수 있게 하지 않는다.
- 향후 다른 utility를 미리 enum에 넣지 않는다. 실제 요구가 확인되기 전에는 `electricity | gas`만 허용한다.

### raw reading fixed-point

새 공통 저장 단위는 meter 표시 기본단위의 **1/1000**을 정수로 보관하는 방식을 우선한다.

```text
electricity: 1 milli-unit = 0.001 kWh = 1 Wh
gas:         1 milli-unit = 0.001 m³
```

권장 canonical 의미 이름:

```text
cumulative_milliunit
```

현재 `cumulative_wh` 값은 전기 meter에 대해 숫자 변환 없이 1:1로 `cumulative_milliunit`에 옮길 수 있다. 예를 들어 `7127.345 kWh`는 현재 `7,127,345 Wh`이고, 새 전기 milli-unit 값도 `7,127,345`다.

이 방식의 장점:

- floating point를 원본 누적값 저장에 사용하지 않는다.
- 전기 기존 값에 산술 변환이 없어 migration 검증이 단순하다.
- 가스의 일반적인 소수 3자리 m³ 입력도 동일 fixed-point 계약으로 처리할 수 있다.
- `cumulative_wh`와 `cumulative_m3` 같은 utility별 nullable column을 readings 한 행에 동시에 두지 않아 invariant가 단순하다.

실제 migration은 반드시 새 versioned migration으로 수행하고 canonical D1에 임의 SQL로 직접 수정하지 않는다. schema test + local D1/workerd round trip에서 기존 전기 값 보존과 index/foreign-key 계약을 먼저 검증한다.

## 4. API migration 방향

현재 same-origin API는 전기 전용 필드명을 갖고 있다. gas 지원 WorkUnit에서는 frontend/Worker를 동시에 갱신해 neutral raw reading contract로 이동한다.

권장 public resource 의미:

```text
MeterResource.utilityKind
ReadingResource.cumulativeMilliUnit
ReadingInput.cumulativeValue   // 사용자가 보는 base unit decimal string
```

`cumulativeValue`의 해석은 meter의 immutable `utilityKind`가 결정한다.

- electricity: decimal kWh, 최대 소수 3자리
- gas: decimal m³, 최대 소수 3자리

client body에서 임의 unit을 보내지 않는다. meter가 canonical unit owner다.

현재 API는 same-origin product API이고 별도 외부 공개 API가 아니지만, migration 중 old static asset과 new Worker가 섞이는 배포 위험은 확인해야 한다. 필요한 경우 한 배포 version 안에서 old/new read compatibility를 좁게 유지하되 영구 이중 contract로 만들지 않는다.

## 5. domain 분리 방향

### 공통으로 재사용할 것

다음 알고리즘의 본질은 단위와 무관하다.

- 누적값 증가 검증
- 두 reading 사이 delta
- elapsed time
- local date boundary 분할/선형 보간
- 검침주기 경계 actual 우선/보간
- 최근 일평균
- 현재 주기 평균
- 마감 예상
- 30일 환산
- 이전 주기 비교
- confidence evidence

하지만 현재 필드명이 `Wh/kWh`에 고정되어 있으므로 gas 값에 그대로 재사용하지 않는다.

권장 순서는:

1. unit-neutral cumulative counter primitive를 작은 모듈로 추출한다.
2. 기존 electricity domain이 그 primitive를 사용하도록 바꾸되 기존 전기 결과를 회귀 테스트로 완전히 보존한다.
3. daily/billing/forecast의 scalar core도 unit-neutral 의미로 이동한다.
4. electricity adapter는 kWh/W를 계산한다.
5. gas adapter는 m³/m³/h를 계산한다.

새 framework나 generic utility platform을 만들지 않는다. 실제 두 utility가 공유하는 계산만 추출한다.

### utility별로 분리할 것

전기 전용:

- kWh / Wh 표시
- 평균 소비전력 W/kW
- `src/domain/tariff.ts` 전기요금 policy

가스 전용:

- m³ 표시
- m³/h
- 도시가스 tariff/provider policy

## 6. 가스요금은 usage와 별도 단계

가스 사용량 기록·일별 사용량·검침주기·forecast는 **도시가스 공급사 정보 없이도 계산 가능**하다. 따라서 가스 tariff 자료가 완성되지 않았다는 이유로 가스 계량기 기능 전체를 막지 않는다.

2026-09-09 공식 자료 확인으로 다음 사실을 고정한다.

### 계량기와 청구 사용량

서울도시가스의 공식 청구서 안내는 당월 사용량을 `당월검침 지침 - 전월검침 지침`의 `m³`로 설명한다. 또한 기체의 온도·압력 차이를 보정하기 위해 보정계수를 적용하고, 평균열량 `MJ/Nm³`와 함께 사용열량을 계산한다고 안내한다.

- https://www.seoulgas.co.kr/front/customer/infoBill
- https://www.seoulgas.co.kr/mobile/customer/checkInfo

### 요금 계산 구조

서울도시가스 공식 요금산정방법의 주택용 예시는 다음 구조다.

```text
{(사용량 × 보정계수) × 평균열량 × 요금단가 + 기본료 + 교체비} + 부가세(10%)
```

- https://www.seoulgas.co.kr/mobile/customer/infoGasPay

즉 앱에 입력한 raw `m³`만으로 전국 공통 정확 요금을 계산한다고 가정하면 안 된다.

### 지역/provider 차이

한국도시가스협회는 도시가스요금이 원료비 + 도매공급비용 + 소매공급비용으로 구성되고, 소매요금은 지방자치단체 승인 대상이라 지역별 차이가 있음을 설명한다. 전국에 복수 도시가스사가 존재하며 공급권역도 다르다.

- https://www.citygas.or.kr/industry/
- https://www.citygas.or.kr/company/find/index.jsp

따라서 gas tariff owner는 최소한 다음을 versioned provenance로 가져야 한다.

- provider/공급권역 식별
- 용도(초기에는 주택용만)
- effective date/window
- 원/MJ 단가
- 기본료 등 provider/지역 항목
- 적용 보정계수의 출처/기간 또는 실제 청구서에서 필요한 입력
- 평균열량의 출처/기간
- VAT/반올림/절사 규칙
- source URL, confirmed/retrieved date

서울도시가스 2026년 9월 요금표에 주택용 취사/난방 단가 `22.5268원/MJ`가 보이더라도 이것을 전국 default 상수로 사용하지 않는다. provider/지역/effective window가 확인된 gas tariff version에서만 사용한다.

### 개인정보 경계

예상 가스요금을 위해 처음부터 사용계약번호나 상세 주소를 수집하지 않는다.

우선순위:

1. 사용자가 공급사/지역을 직접 선택할 수 있는 최소 설정 검토
2. 공식 tariff policy로 예상 계산
3. 계정번호·상세 주소 같은 개인정보가 정말 필요한 기능이 생길 때만 별도 Discussion Gate

## 7. 구현 순서

다음 순서가 현재 repository에서 migration 위험이 가장 낮다.

### Phase A — data/API foundation

- `utilityKind` meter contract 추가
- 기존 meter `electricity` backfill
- readings fixed-point를 neutral `cumulative_milliunit` 의미로 migration
- API resource/input neutralization
- 기존 실제 전기 데이터 값 보존 검증

### Phase B — shared counter/domain core

- unit-neutral cumulative/interval primitive 추출
- electricity wrapper 결과 불변 검증
- daily/billing/forecast scalar 의미 neutralization
- gas m³/m³/h adapter 추가

### Phase C — 실제 전기/가스 UI

- persistent `[전기] [가스]` switch
- utility별 meter 목록/선택
- utility별 empty state와 meter 생성
- 가스 quick input `m³`
- 기록/분석/설정에서 utility에 맞는 단위 표시
- viewer/owner 권한 계약 동일 적용

### Phase D — gas tariff

- provider/지역 selection 최소 UX 결정
- 공식 현재 tariff provenance 확보
- gas tariff를 electricity tariff와 별도 모듈로 구현
- 근거가 없는 provider/month는 `예상 가스요금`을 만들지 않고 명시적 미연결 상태 유지

### Phase E — runtime E2E

- 기존 전기 실제 user/meter/readings migration 보존
- 전기 새 기록/예상요금 회귀
- 가스 meter 생성 → 여러 raw reading → reload → 일별/주기/forecast 복원
- 전기/가스 탭 전환 시 meter/readings state가 서로 섞이지 않음
- owner/viewer access가 utility 종류와 무관하게 동일하게 강제됨

## 8. 테스트에서 보호할 추가 계약

### migration

- 기존 모든 meter는 `electricity`
- 기존 `cumulative_wh` 숫자가 새 electricity milli-unit로 1:1 보존
- reading ID/time/order/index/cascade 보존
- migration 재적용/부분 실패 안전성

### gas reading

- `0`, 동일값 재기록
- 소수 3자리 m³
- 4자리 이상 precision 거부
- 이전보다 작은 누적값 거부
- 같은 시각 중복 거부
- 자정/월말/연말/DST 분할

### UI

- utility switch keyboard 접근 가능
- 전기 화면에서 kWh/W/예상 전기요금
- 가스 화면에서 m³/m³·h 의미/예상 가스요금 상태
- 한 utility에 meter가 없어도 다른 utility 데이터가 노출되지 않음
- 320px/iPhone viewport에서 두 utility 탭과 숫자 입력이 깨지지 않음

### tariff

- gas usage 계산은 tariff 미설정이어도 정상
- provider가 없는 경우 가짜 요금 표시 금지
- provider/effective month가 안 맞으면 이전 단가 자동 연장 금지
- 공식 source/provenance 없는 숫자 금지

## 9. 현재 결정

**채택**

- 같은 앱에서 `전기 / 가스` 전환
- 가스는 도시가스 계량기 raw cumulative m³ 기록
- 기존 meter multiple-support와 owner/viewer model 재사용
- usage/calendar/billing/forecast의 실제 공통 부분 재사용
- gas tariff는 electricity tariff와 별도 owner
- 기존 전기 데이터를 보존하는 versioned D1 migration

**보류**

- repository/Cloudflare/D1 resource rename
- provider 계정번호 연동
- 상세 주소 자동 공급사 판별
- 다른 utility 종류 추가
- offline write/background sync

## 10. 다음 WorkUnit의 Discussion Gate

다음 자체는 이미 제품 방향이 확정되어 있으므로 다시 묻지 않는다.

- `전기 / 가스` 두 종류 지원
- `가스` 명칭
- 기존 meter를 electricity로 보존
- gas raw meter 단위 m³
- gas usage와 gas tariff 분리

다음이 실제 구현 결과를 바꿀 때만 질문한다.

- canonical D1 migration에서 기존 데이터를 보존할 수 없는 파괴적 선택이 필요함
- 공급사/지역 설정에 상세 주소·계약번호 같은 개인정보가 필요함
- gas tariff가 서로 다른 동급 데이터 모델 중 장기 public contract를 갈라놓음
- 기존 public URL/서비스명/repository rename을 해야 함

그 외의 필드 rename, unit-neutral 내부 refactor, 테스트 보완, stale 문서 정리는 Discussion Gate 없이 최소 변경으로 진행한다.
