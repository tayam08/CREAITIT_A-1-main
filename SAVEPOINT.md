# Current Savepoint: 면접용_로컬_챗_v1

- **Status:** validated-integrated-delete-control
- **Created:** 2026-09-02T00:01:58+09:00
- **Checkpoint digest:** `7779925b5f7c4fc74a6bc5259f4e7305cfd5417b3126e3a9bc4153a064271d73`
- **Immediate next step:** 운영진이 불필요한 테스트 대화 1건에서 삭제 확인창과 화면 갱신을 확인한다.

## Confirmed state

- 제품 식별자는 `면접용_로컬_챗_v1`이며 `/logo-concept`의 360도 메탈 CREAI+IT 엠블럼과 앞·뒷면 처리를 보존한다.
- GPT-5.6 Luna는 명시적으로 고정되어 있으며 다른 모델로 자동 대체하지 않는다.
- app-server, 브라우저 브리지, 관리자 서버는 loopback-only이고 capability token 및 Origin 검증을 유지한다.
- 사용자가 대화 저장과 채용 시스템 전송에 명시적으로 동의한 뒤에만 세션을 시작한다.
- 대화 종료 시 로컬 SQLite와 원격 관리자 D1에 세션 상태를 남기고, 초대 토큰이 있으면 전용 수신 Worker로 재시도 가능한 전송을 수행한다.
- 채용 시스템은 원문 TXT를 비공개 R2에 저장하고, 이름·이메일·전화번호·식별번호를 제거한 텍스트만 Workers AI에 전달한다.
- AI 결과는 요약·관찰 신호·후속 질문만 제공하며 점수나 자동 채용 결정을 만들지 않는다.
- 지원자 상세 화면은 14일 서명 초대 링크, 세션별 요약, TXT 원문 다운로드, 인쇄/PDF 보기를 제공한다.
- 지원자 상세 화면의 삭제 버튼은 확인 후 비공개 R2 원문과 D1 대화·요약 메타데이터를 제거하고 감사 로그를 남긴다.
- 관리자 채용 사이트는 Cloudflare Access 보호를 유지하고 서명 토큰 수신만 별도 Worker로 분리한다.
- 사용자 요청에 따라 공개 UI Worker 두 곳이 배포되어 있으나 Luna 실행 서비스 자체는 계속 로컬 장치에서만 동작한다.

## Verification

- 메인 프로젝트 `npm test`: 5/5 통과
- 메인 프로젝트 `npm run lint`: 오류 0
- 채용 프로젝트 `npm run lint`, `npx tsc --noEmit`, `npm run build`: 통과
- 로컬 `/logo-concept`, app-server `/readyz`, 관리자 페이지: HTTP 200
- 실제 GPT-5.6 Luna smoke: `LUNA-LIVE`
- 채용 수신 Worker: 잘못된 토큰 401, 유효한 서명 토큰은 지원서 조회 단계까지 통과
- 채용 D1 `luna_conversations` 마이그레이션 적용 완료
- 원격 채팅 D1 `chat_sessions` 런타임 스키마 적용 완료
- 채용 삭제 API가 운영 빌드에 포함되었고 lint, TypeScript 검사, Vinext 빌드 및 Sites/Workers 배포가 완료됨

## Deployments

- Chat UI: https://interview-local-chat-v1.atb1135.workers.dev/logo-concept
- Hiring admin: https://creaiit-people-os.atb1135.workers.dev
- Hiring private Site: https://creaiit-people-os.atb1135.chatgpt.site
- Signed ingestion: https://creaiit-people-os-luna-ingest.atb1135.workers.dev/api/integrations/luna/conversations

## Privacy and security decisions

- 원문은 공개 객체 URL을 만들지 않고 R2 binding으로만 읽는다.
- 초대 토큰은 지원서 ID, 발급·만료 시각, nonce를 HMAC-SHA256으로 서명하며 14일 뒤 만료된다.
- 수신 본문은 700KB, 메시지 500개, 메시지당 20,000자로 제한한다.
- 관리자 다운로드와 PDF 화면은 기존 Cloudflare Access 로그인과 감사 로그를 요구한다.
- 로컬 전송 실패는 SQLite outbox에서 지수 백오프로 재시도하고 토큰·원문을 콘솔에 출력하지 않는다.
- 비밀키와 원격 관리자 키는 저장소에 커밋하지 않는다.

## Known limitations

- 공개 Chat UI만으로는 응답할 수 없으며 각 사용자의 로컬 app-server와 ChatGPT 로그인이 필요하다.
- 삭제 기능의 실제 데이터 제거 검증은 운영진이 불필요한 테스트 세션에서 수행해야 한다.
- 채용 사이트 로컬 미리보기는 Cloudflare Access 개발 프록시에 `cloudflared`가 필요하지만 운영 빌드·배포에는 영향이 없다.
- 기존 `.openai/hosting.json`의 Sites 프로젝트 ID는 조회되지 않아 실제 Cloudflare Worker 배포 경로로 갱신했다.

## Artifact manifest

- `app/page.tsx` — 49235 bytes — `ec639589d809597fd80ea0b16c5e7d2939fe1299b8e7e7c8a9b59de8153b72ed`
- `app/api/chat-log/route.ts` — 8511 bytes — `3aa91ab3ff5f272b225f16bbcee4d919d10adf550f2b1f31cac5a6a30487d79e`
- `db/schema.ts` — 1263 bytes — `3d763e5d6788947a3634cada2e4f0c1f4ecc6c466e0610fdfde1d5d490975e50`
- `db/index.ts` — 2322 bytes — `3b11bdea1168131d1f5d755c19d773289bfdb963f3d70d3d05e60f246ff77bdb`
- `scripts/luna-proxy.mjs` — 16184 bytes — `4d76297ea3ea83e2ebdd642bf10aa2f6002d0fe60700337280eadd0c8b2e1c6a`
- `scripts/luna-admin.mjs` — 13737 bytes — `af6de2d15d9872ad0b09139468fd0165b5b4c930380e5dcc0f6b2f2c037a055c`
- `app/admin/page.tsx` — 12231 bytes — `a0f76756c57fcc32c9a6ca0de2f56d67a1e56c5234fa538741e301932245dc73`
- `README.md` — 8380 bytes — `8de95def52a1fc37dbdee3295687ae42ca4be6428522d7409e12555dc9876201`
- `tests/rendered-html.test.mjs` — 7671 bytes — `c8338ae874952219aeef98ffa8ed80345c697816db949ed8005cdda39fd2e520`

## Resume checklist

- `AGENTS.md`, `AGENT_BRIDGE.md`, `SAVEPOINT.md`, `docs/savepoints/latest.json`을 읽는다.
- `npm run bridge -- inbox --agent codex`와 `npm run bridge -- overview`를 실행한다.
- 메인 `npm test`, `npm run lint`, 채용 시스템 lint/typecheck/build를 실행한다.
- `npm run local` 후 `/logo-concept`, `/readyz`, 관리자 4502, `npm run luna:smoke`를 확인한다.
- 실제 지원자 테스트 시 개인정보 동의와 운영진 Access 로그인을 확인한다.

Historical record: `docs/savepoints/20260901T232647+0900-interview-local-chat-v1-integration.md`
