# AGENTS.md

## 작업 순서

```text
사용자 의도
→ 최신 저장소 상태
→ 기존 구현/계약
→ 최소 변경
→ 검증
→ Git 반영
```

* 과거 SHA/PASS/branch 상태를 현재 사실로 재사용하지 않는다.
* 작업과 직접 관련된 파일과 테스트부터 확인한다.
* 무관한 리팩터링이나 전체 포맷 변경을 하지 않는다.
* 기존 owner가 있다면 새 abstraction보다 재사용한다.
* 확인되지 않은 미래 기능을 미리 구현하지 않는다.

## Public 저장소 보안

다음을 저장소에 절대 커밋하거나 포함하지 않는다:

* Google OAuth Client Secret
* Cloudflare API Token
* session/signing secret
* 실제 인증 token
* 실제 `.env`
* 실제 사용자 개인정보
* 실제 D1 dump
* 실제 계량기 기록
* cookie/session 데이터

`.env.example`에는 실제 Secret을 넣지 않는다.

## Domain 기본 원칙

다음 영역은 향후 UI/API와 가능한 한 독립적으로 테스트한다:

* 누적 계량값
* 측정 구간 사용량
* 시간 계산
* 일자 경계 보간
* 검침주기
* 검침 경계 보간
* 예측
* 전기요금
* 가스요금

전기요금 policy와 순수 사용량 domain은 분리한다.
가스요금 policy도 순수 사용량 domain 및 전기요금 policy와 분리한다.

## 전기 / 가스 확장

* 사용자-facing 상위 utility 명칭은 `전기`, `가스`를 사용한다.
* meter 종류는 실제 구현 시 `electricity | gas`로 명시하고, 기존 meter는 migration에서 `electricity`로 보존한다.
* meter 종류는 누적값 단위 의미를 소유하므로 생성 후 in-place 변경할 수 있게 하지 않는다.
* 원본 누적값은 floating point로 저장하지 않는다. 전기는 kWh 표시값, 가스는 m³ 표시값을 정확한 fixed-point 정수로 보존한다.
* 현재 `cumulative_wh`/`cumulativeKwh` 같은 전기 전용 이름에 가스 값을 억지로 넣지 않는다. gas 지원 시 versioned D1 migration과 API/domain 정합화를 함께 수행한다.
* 누적값 증가, elapsed time, 날짜 경계 보간, 검침주기, forecast처럼 실제로 단위와 무관한 계산만 공통화한다.
* 평균 소비전력 W/kW와 전기 tariff는 전기 전용이다. 가스는 m³, m³/h와 별도 gas tariff를 사용한다.
* 가스 원본 계량값만으로 최종 사용처를 분리해 해석하지 않는다.
* 가스 사용량/forecast는 tariff가 없어도 동작해야 한다. 예상 가스요금은 공급사/지역/effective window/공식 provenance가 확인된 범위에서만 계산한다.
* 가스 공급사 계정번호나 상세 주소 같은 개인정보는 실제 기능에 필수임이 확인되기 전 수집하지 않는다.
* 세부 확장 계약은 `docs/GAS_METER_DIRECTION.md`를 따른다.

## 시간

* 서버 로컬 시간에 의존하지 않는다.
* 기본 환경은 `Asia/Seoul`.
* 계량기별 timezone 확장을 허용한다.
* 월말/연말/윤년/검침 경계를 고려한다.

## 권한

* 사용자는 자기 계량기만 기본 접근 가능
* 공유받은 경우에만 다른 사용자 계량기 접근 가능
* frontend 표시 여부가 아니라 서버/API에서 권한을 강제한다.

## Git 안전

별도 프로젝트 정책이 생기기 전까지 다음 규칙을 엄격히 준수한다:

* 큰 개발을 main에 직접 누적하지 않는다.
* 안전한 work branch를 사용한다.
* force push 금지
* `reset --hard` 금지
* `git clean -fd` 금지
* 자동 stash 금지
* 자동 충돌 해결 금지
* `git add .` 금지
* `git add -A` 금지
* `git commit -a` 금지
* VERSION/tag/release/deploy는 사용자 승인 없이 하지 않는다.
