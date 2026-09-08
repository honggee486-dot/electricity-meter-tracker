# NEXT_WORK.md

## 현재 완료: architecture baseline + mobile UI prototype

- [x] Vite + TypeScript + 기본 DOM/CSS 선택, 런타임 프레임워크 없음
- [x] Workers Static Assets → Worker API → D1의 향후 방향 및 무료 운영 조건 정리
- [x] UI / usage / tariff / API / auth / persistence 최소 책임 경계 정리
- [x] Google subject ↔ 내부 user_id, 서버 권한, owner/viewer 방향 정리
- [x] 홈 즉시 입력, 숫자 형식에 따른 버튼 상태, 자동 시각과 임시 체험 기록
- [x] 기록 / 분석 / 읽기 전용 설정 / 공유 준비 UI
- [x] 단일 demo fixture, 실측/보간 표시 예시, 예측 의미 분리
- [x] strict TypeScript / 정적 build / Playwright 브라우저 검증 구성

구현 범위와 실행 명령은 README를 기준으로 합니다. CI, iPhone 실기기 증거, 실제 저장·계산·인증은 포함하지 않습니다.

## 다음 1순위 WorkUnit: 순수 사용량 구간 domain + 자동 테스트

이번 UI에서 계산 없이 고정 표시한 가장 작은 실제 값부터 구현합니다. UI 입력 형식 제한을 production 누적값 정책으로 재사용하지 않습니다.

완료 조건:

1. 단위·소수 정밀도·허용 범위와 잘못된 입력 처리 계약을 정의한다.
2. 두 누적 기록으로 구간 사용량(kWh), 경과시간, 평균 소비전력(W)을 계산하는 순수 TypeScript 모듈을 구현한다.
3. 감소한 누적값, 중복/역전 시각, 빈 값/유효하지 않은 값, 소수값, 임의 시각, 날짜를 넘는 구간에 대한 자동 테스트를 통과한다.
4. timestamp/계량기 timezone 계약을 명시하고 시스템 timezone이 달라도 동일 결과임을 검증한다.
5. DOM·Cloudflare·DB 의존성이 없고 기존 UI build/브라우저 검증이 유지된다. API/영속 저장으로 범위를 넓히지 않는다.

## 그 이후 후보 (별도 WorkUnit에서 범위 확정)

- 날짜 경계 분할/보간 및 실제값·추정값 provenance
- 검침주기 및 경계 보간: 29~31일이 없는 달의 정책을 먼저 결정
- 최근 평균 / 주기 평균 / 마감 예측 / 30일 환산 및 신뢰도
- users / meters / readings / meter_members 구체 데이터 설계
- Google 로그인과 Worker API의 서버 권한, D1 저장
- version/effective date를 갖는 독립 전기요금 policy
- 실제 공유, PWA, 운영비 확인 및 별도 승인된 배포

VERSION/tag/release/deploy는 이번 단계에 포함하지 않습니다.
