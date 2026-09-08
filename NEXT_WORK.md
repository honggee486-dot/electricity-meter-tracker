# NEXT_WORK.md

## 작업 큐

### 1. Product/architecture baseline 결정
* [ ] 최소 frontend 방식 결정
* [ ] Cloudflare hosting/API 방식 결정
* [ ] Cloudflare D1 구조 검토
* [ ] 테스트 환경 구성 방안
* [ ] 인증 경계 설정

### 2. 계산 domain 설계 및 구현
* [ ] 누적값 validation
* [ ] 직전 기록 이후 사용량 계산
* [ ] 경과시간 계산
* [ ] 평균 소비전력 계산
* [ ] 일자별 보간 (날짜 경계 분할)
* [ ] 검침주기 산정
* [ ] 검침 경계 보간
* [ ] 사용량 예측 로직

### 3. 데이터 구조
* [ ] 엔티티 후보 정의 (users, meters, readings, meter_members)
* [ ] 스키마 초안 작성 (실제 DB migration은 추후 진행)

### 4. Google 로그인
* [ ] OAuth 흐름 및 세션/토큰 처리 설계

### 5. 모바일 입력 UI
* [ ] 핵심 입력 흐름(계량기 누적값 빠른 입력 및 현황 확인) 구현

### 6. 전기요금 policy
* [ ] 계량기 및 주택용 요금제/누진제 정책 분리 구현

### 7. 계량기 공유
* [ ] 계량기별 다중 사용자 공유 및 권한 제어 구현
