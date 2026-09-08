# Tariff policy contract

## 범위

전기요금 policy는 순수 사용량 domain(`src/domain/usage.ts`, `forecast.ts` 등)과 분리된 독립 모듈(`src/domain/tariff.ts`)입니다. policy 모듈은 정수 Wh 총사용량과 검침 마감 월만 입력으로 받고 usage/billing/calendar 내부를 import하지 않습니다.

현재 v1 범위:

- 주택용(저압) 2023-11-09 개정적용 버전 1개
- 하계(마감 월 7~8월) 300/450kWh 확대 누진 구간
- 기타계절(마감 월 1~6, 9~12월) 200/400kWh 누진 구간
- 구간별 기본요금(호당)과 전력량요금(kWh당)
- policy version, 적용 마감 월 창(window), 공식 출처 provenance, 저장소 확인일
- 항목별 내역(기본요금/전력량요금/소계)과 명시적 미반영 항목 목록

명시적으로 포함하지 않음(v1 데이터에서 검증 근거가 부족하여 제외):

- 연료비조정요금 단가(분기별 변경)
- 기후환경요금 단가
- 부가가치세와 전력산업기반기금 계산(과세 기준에 미검증 항목이 포함됨)
- 복지할인(구 필수사용량보장공제) — 복지할인 대상 전환 확인
- 1,000kWh 초과 누진할증 단가(출처 페이지 확인에서 적용 계절 표기가 불일치)
- 동계 소용량 할인
- TV수신료

위 항목들은 `excludedComponents`로 policy 데이터에 명시되고 UI에 그대로 노출됩니다. 결과 금액은 **기본요금+전력량요금 추정 소계**이며 실제 청구액이 아닙니다.

## 데이터 provenance

`TARIFF_POLICIES`의 수치는 2026-09-09에 다음 공식 출처에서 직접 확인했습니다.

- 한국전력 사이버지점 주택용(저압/고압) 요금표: https://cyber.kepco.co.kr/ckepco/front/jsp/CY/E/E/CYEEHP00101.jsp
  - 하계(7.1~8.31) 300/450, 기타계절(1.1~6.30, 9.1~12.31) 200/400
  - 기본요금 910 / 1,600 / 7,300원, 전력량요금 120.0 / 214.6 / 307.3원/kWh
  - 개정적용 2023-11-09
- 찾기쉬운 생활법령정보(2026-08-15 작성 기준): https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1008&ccfNo=2&cciNo=1&cnpClsNo=1
  - 동일 구간 경계와 기본요금·전력량요금, 전력산업기반기금 2.7%(v1에서는 과세 기준 미완결로 미계산)

새 policy version을 추가할 때는 기존 version의 `appliesToCloseMonth`를 닫고 새 version의 `appliesFromCloseMonth`부터 열어 window가 겹치지 않게 합니다. 수치 확인 불가 항목은 임의로 채우지 않고 `excludedComponents`에 남깁니다.

## 계산 규칙

- 계절은 검침주기의 마감 월(close month) 기준으로 선택합니다. v1 단순화이며, 마감 월이 요금표 적용 월과 다른 케이스는 실제 한전 검침 정의가 확인되면 version 갱신으로 다룹니다.
- 전력량요금은 총사용량을 구간별 Wh로 분할해 구간 단가와 곱합니다. 곱은 BigInt로 정확히 누적하고(단위 1/10,000원) 최종적으로 1원 단위 반올림(half-up)을 한 번 적용합니다. 한전 고시의 항목별 반올림 규칙은 미확인이라 이 반올림은 저장소 v1 규칙입니다.
- 기본요금은 총사용량이 속한 구간의 호당 금액 1회입니다. 구간 경계값 자체는 낮은 구간에 속합니다("200kWh 이하").
- 결과는 `subtotalWon = baseFeeWon + energyFeeWon`이며 절대 청구액을 대표하지 않습니다.

## 검증

`domain-tests/tariff.test.mjs`가 공식 표 기준 기대값으로 다음을 검증합니다.

- 정책 registry 자체의 유효성(versionId, 출처, 확인일, 계절 월 전체 커버)
- 구간 경계(이하/초과) 기본요금 전환, 0 사용량 최소 요금
- 하계/기타계절 동일 사용량의 구간 차이
- 반올림 half-up 경계(24536.5원 → 24537원)와 절상 케이스
- 미커버 마감 월, 잘못된 사용량/월, window 겹침, band 위반의 명시적 오류 코드

```sh
npm run test:domain
```

`tests/ui.spec.ts`는 고정 시각 mock에서 홈 화면 예상 전기요금이 정확한 원 단위와 provenance 문구(개정적용일, 확인일, 미반영 항목)로 렌더링되는지 검증합니다. UI는 policy가 커버하지 않는 마감 월에서 기존 `요금 정책 연결 전` 문구를 유지하고, 계산 입력이 부족하면 `자료 부족`을 표시합니다.

## Runtime evidence 경계

Repository test는 정책 데이터와 계산식의 일관성만 검증합니다. 실제 한전 청구서와의 대조, 분기별 연료비조정액 추적, 하계 실측 검증은 이 모듈 범위가 아니며 별도 확인이 필요합니다. 실제 청구액 비교가 필요해지면 `excludedComponents` 해소를 새 version 데이터로 먼저 처리합니다.
