# PWA installability contract

## 범위

현재 PWA 범위는 **설치 가능한 app shell**까지입니다.

포함:

- root Web App Manifest
- `192x192`, `512x512` 일반 PNG 아이콘
- `512x512` maskable PNG 아이콘
- iOS 홈 화면용 `180x180` apple-touch-icon
- live product 기준 title/description/theme/head metadata
- `standalone` display와 root `start_url` / `scope`

명시적으로 포함하지 않음:

- service worker
- offline cache
- offline reading write queue
- Background Sync
- push notification

계량기 기록은 원본 데이터 정확성이 핵심이므로 네트워크 단절 중 mutation을 임의 queue/replay하는 동작은 별도 제품 계약 없이 추가하지 않습니다.

## Asset provenance

`public/icons/`의 PWA 아이콘은 이 저장소용으로 직접 생성한 단순 기하 도형 PNG입니다. 외부 이미지, 로고, 폰트, 제3자 asset을 포함하지 않습니다.

## Repository verification

`tests/pwa.spec.ts`는 build 결과의 다음 계약을 검증합니다.

- live title/description과 manifest/apple-touch-icon 연결
- manifest의 app identity, `start_url`, `scope`, `standalone` display
- 192/512 일반 아이콘과 512 maskable 아이콘 선언
- 모든 PNG asset의 응답 성공, PNG signature, 실제 pixel dimension
- 과거 UI demo/sample 문구가 app shell metadata에 남지 않음

기본 검증은 다음 순서를 사용합니다.

```sh
npm run build
npm run test:ui
```

GitHub Actions에서는 기존 Chromium/WebKit UI 단계가 같은 built preview를 사용합니다.

## Runtime evidence 경계

Repository test는 manifest와 asset 계약을 검증하지만 특정 OS/browser의 설치 promotion UI가 실제로 노출되는 것까지 증명하지 않습니다. 설치 promotion은 브라우저 버전, secure context, 이미 설치되었는지 여부, 사용자 engagement 같은 runtime 상태의 영향을 받습니다.

따라서 Windows Chrome/Edge나 실제 iPhone Safari의 설치 UI/standalone 실행 체감이 필요할 때는 해당 환경에서 별도 runtime evidence를 확인합니다. 이 검증 때문에 service worker나 offline mutation을 추가하지 않습니다.
