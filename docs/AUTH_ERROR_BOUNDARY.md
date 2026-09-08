# Google auth error boundary

## 목적

Google GIS credential 검증 실패의 내부 진단과 public API/UI 오류를 분리합니다.

## Public contract

`POST /api/auth/google`에서 credential 검증이 실패하면 기존 상태/코드를 유지합니다.

- HTTP `401`
- error code `INVALID_GOOGLE_CREDENTIAL`
- public message `Google credential could not be verified.`

verifier, Google signing-key provider, runtime fetch에서 얻은 상세 오류 문자열은 public JSON에 포함하지 않습니다. frontend도 `INVALID_GOOGLE_CREDENTIAL`의 server message를 사용자 화면에 그대로 재표시하지 않고 고정된 일반 안내를 사용합니다.

## Server diagnostic contract

Worker는 credential 검증 실패의 원인 조사에 필요한 오류 이름/message를 server diagnostic에 남길 수 있습니다. 다만 다음 경계를 지킵니다.

- 요청의 실제 Google credential 문자열이 diagnostic detail에 섞이면 `[credential redacted]`로 치환합니다.
- diagnostic 문자열 길이를 제한해 예외 객체의 비정상적으로 큰 message가 그대로 로그로 확장되지 않게 합니다.
- credential, session token, cookie, secret 값을 의도적으로 로그하지 않습니다.
- 테스트에서는 injectable log sink를 사용해 public response와 server diagnostic 분리를 검증합니다. 제품 runtime은 기본적으로 `console.error`를 사용합니다.

## Regression evidence

`worker-tests/auth.test.mjs`는 provider/verifier detail이 server diagnostic에는 남으면서 실제 credential과 public JSON에는 남지 않는지 검증합니다.

`tests/ui.spec.ts`는 보수적으로 server mock이 상세 message를 반환하더라도 frontend가 해당 detail을 사용자 화면에 노출하지 않는지 검증합니다.

이 변경은 Google identity semantics, CSRF, `401 / INVALID_GOOGLE_CREDENTIAL`, session, D1 identity mapping을 변경하지 않습니다.
