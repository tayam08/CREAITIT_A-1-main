# 면접용_로컬_챗_v1

CREAI+IT 학회 로고의 최종 360° 메탈 엠블럼과 GPT-5.6 Luna를 결합한 로컬 전용 브라우저 챗봇입니다. 웹 UI, Codex app-server, 브라우저 브리지는 모두 사용자 컴퓨터의 loopback 주소에서만 실행됩니다.

## 가장 빠른 실행

필수 환경:

- Windows 10/11, macOS 또는 Linux
- Node.js 22.13 이상
- 최초 설치와 ChatGPT 로그인에 필요한 인터넷 연결
- GPT-5.6 Luna를 사용할 수 있는 ChatGPT 계정

Windows에서는 저장소를 내려받은 뒤 `START_INTERVIEW_CHAT.cmd`를 더블 클릭하세요. 처음 한 번은 `npm ci`가 자동 실행되고, 준비가 끝나면 `http://localhost:3000/logo-concept`가 기본 브라우저에서 열립니다.

macOS/Linux에서는 다음과 같이 실행합니다.

```sh
chmod +x start-interview-chat.sh
./start-interview-chat.sh
```

터미널을 선호하면 아래 명령도 같습니다.

```sh
npm ci
npm run local:open
```

## 각 사용자의 계정으로 연결되는 방식

앱은 공유자의 키나 계정을 포함하지 않습니다.

1. 실행한 컴퓨터에 이미 Codex용 ChatGPT 로그인이 있으면 그 로컬 계정을 자동으로 읽습니다.
2. 로그인이 없으면 화면의 `SIGN IN WITH CHATGPT`를 누릅니다.
3. 새 브라우저 탭에서 본인 ChatGPT 계정으로 인증합니다.
4. 인증이 끝나면 앱이 GPT-5.6 Luna 세션을 만들고 대화를 시작합니다.

계정 토큰은 각 사용자의 Codex 로컬 환경이 보관·갱신하며 Git 저장소, 브라우저 코드 또는 다른 사용자에게 복사되지 않습니다. 해당 계정에 GPT-5.6 Luna 권한이 없으면 앱이 명확한 안내를 표시하며 다른 모델로 몰래 전환하지 않습니다.

## 로컬 전용 보안 경계

- 사이트: `http://localhost:3000`
- Codex app-server: `ws://127.0.0.1:4500`
- 브라우저 브리지: `ws://127.0.0.1:4501`
- 로컬 관리자 화면: `http://127.0.0.1:4502`
- app-server와 브리지는 실행 시 `.runtime/`에 생성되는 일회성 capability token으로 연결됩니다.
- 브리지는 `localhost:3000`과 `127.0.0.1:3000` Origin만 허용합니다.
- 개발 서버와 미리보기 서버는 `localhost:3000`에 명시적으로 고정되며, 같은 네트워크의 다른 기기에는 노출되지 않습니다.
- `.runtime/`, 환경 변수 파일, 인증 파일과 의존성은 Git에서 제외됩니다.

대화 기록은 기본적으로 `.runtime/chat-logs.sqlite`에 저장되며 최근 10,000개로 제한됩니다. 원격 관리자 저장은 `LUNA_REMOTE_LOG_URL`, 채용 시스템 연동은 `LUNA_HIRING_INGEST_URL`이 설정된 경우에만 동작합니다. 채용 시스템 초대 링크의 서명 토큰은 브라우저 세션과 로컬 재시도 큐에만 머물며 저장소에 커밋하지 않습니다. 비밀 키는 저장소에 추가하지 마세요.

대화를 시작하려면 기록 저장 및 운영진 검토 목적의 문서화 동의가 필요합니다. 각 대화에는 별도 세션 ID가 부여되며 `채팅 종료`를 누르면 종료 시각과 상태가 함께 저장됩니다. 로컬 관리자 화면(`http://127.0.0.1:4502`)에서는 세션별 원문을 실시간으로 확인하고 다음 형식으로 정리할 수 있습니다.

- `TXT 다운로드`: 시간, 화자, 대화 원문이 포함된 UTF-8 문서
- `PDF 저장 / 인쇄`: A4 인쇄 화면을 열어 브라우저의 PDF 저장 기능으로 보관

전송 실패에 대비한 로컬 outbox가 원격 로그 이벤트를 재시도합니다. 채용 시스템으로 지원자 원문을 보내거나 AI 요약을 생성하는 기능은 별도의 개인정보 외부 전송 승인과 운영 환경 설정이 완료된 뒤에만 활성화해야 합니다.

이 프로젝트는 원래 공개 서버 배포용이 아닙니다. 현재 Codex app-server의 WebSocket 전송 방식은 실험적 기능이므로 면접·데모용 로컬 실행 범위를 유지하는 것이 기본 원칙입니다. 다만 운영자 판단으로 디자인 쇼케이스를 별도 공개 URL에 배포해 둔 경우, 아래 섹션을 참고하세요.

## 배포된 디자인 쇼케이스 (선택 사항)

운영자가 배포해 둔 경우, 아래 링크에서 디자인과 레이아웃을 미리 볼 수 있습니다.

- 쇼케이스 URL: `https://interview-local-chat-v1.atb1135.workers.dev`
- 이 링크는 **디자인 미리보기용**입니다. 실제 채팅은 이 링크를 열어본 것만으로는 되지 않고, 위 "가장 빠른 실행" 절차대로 **본인 컴퓨터에서 로컬 프로그램을 실행하고 본인 ChatGPT 계정으로 로그인**해야 작동합니다.
- **브라우저 제약**: 이 배포 링크에서 로컬 LUNA와 연결하려면 Chrome, Edge 등 Chromium 계열 브라우저를 사용하세요. Safari는 보안 정책상 `https://` 페이지에서 로컬 `ws://` 연결을 차단하므로 배포 링크에서는 채팅이 붙지 않습니다. Safari 사용자는 `http://localhost:3000`으로 직접 실행해서 사용하세요.

## 원격 대화 로그 & 관리자 대시보드 (선택 사항)

운영자가 여러 사용자의 대화를 한 곳에서 실시간으로 모아보고 싶을 때만 쓰는 기능입니다. 기본값은 완전 비활성화이며, 아래 설정을 하지 않으면 대화는 각자 컴퓨터의 `.runtime/chat-logs.sqlite`에만 남고 어디로도 전송되지 않습니다.

1. 운영자에게 `.env` 파일을 요청해서 프로젝트 루트(레포를 내려받은 폴더 최상단)에 그대로 저장하세요. 이 파일은 저장소에 포함되어 있지 않고 `.gitignore`로 제외되어 있어 직접 전달받아야 합니다. 내용은 다음과 같은 형태입니다.
   ```
   LUNA_REMOTE_LOG_URL=https://<배포 주소>/api/chat-log
   LUNA_REMOTE_LOG_KEY=<운영자가 발급한 키>
   LUNA_HIRING_INGEST_URL=https://<채용 전용 수신 Worker 주소>/api/integrations/luna/conversations
   LUNA_EXTRA_ALLOWED_ORIGINS=https://<Chat UI 배포 주소>
   ```
   HR OS의 `열기` 버튼처럼 배포된 Chat UI에서 이 컴퓨터의 로컬 브리지에 접속할 때는
   `LUNA_EXTRA_ALLOWED_ORIGINS`에 그 Chat UI의 정확한 origin을 등록해야 합니다. 여러 주소는
   쉼표로 구분하고, 경로나 마지막 `/`는 포함하지 않습니다.
2. `.env`가 프로젝트 루트에 있는 상태로 평소처럼 실행하면(`npm run local:open` 또는 실행 파일), 그 세션의 대화가 로컬 기록과 동시에 운영자의 원격 저장소로도 전송됩니다.
3. 관리자 대시보드는 운영자 전용입니다. URL(`.../admin`)과 접속 키는 운영자에게 별도로 문의하세요 — 저장소나 README에는 포함하지 않습니다. 대시보드에서는 이름별로 대화 전체를 보고, 필요하면 특정 사용자의 기록을 삭제할 수 있습니다.

## GitHub에서 공유하기

저장소는 비공개로 유지하고 GitHub의 `Settings → Collaborators`에서 사용할 사람만 초대하는 구성을 권장합니다. 초대받은 사람은 저장소를 clone하거나 ZIP으로 내려받은 뒤 자신의 컴퓨터에서 위 실행 파일을 사용하면 됩니다. 저장소 접근 권한과 ChatGPT 모델 사용 권한은 서로 별개입니다.

## 개발 및 검증

```sh
npm run local       # 브라우저를 열지 않고 네 서비스를 실행
npm run luna:smoke  # 로그인된 계정으로 Luna 왕복 확인
npm test            # 프로덕션 빌드와 정적 회귀 테스트
npm run lint        # 코드 검사
```

## Codex와 Claude CLI 협업

두 에이전트는 터미널 대화를 직접 공유하지 않지만, 로컬 협업 브리지로 결정·진행 상태·파일 담당·피드백을 교환할 수 있습니다. 실시간 메시지는 Git에서 제외되는 `.agent-bridge/`에만 저장됩니다.

```sh
npm run bridge -- init
npm run bridge -- overview
npm run bridge -- inbox --agent claude
```

Claude CLI의 기존 세션에는 `CLAUDE.md와 AGENT_BRIDGE.md를 읽고 bridge inbox를 확인해줘`라고 한 번 요청하세요. 이후 프로젝트 지침을 읽는 새 세션은 협업 절차를 자동으로 따릅니다. 자세한 명령과 보안 원칙은 [AGENT_BRIDGE.md](AGENT_BRIDGE.md)에 있습니다.

핵심 화면은 `/logo-concept`이며, `/`에는 원래의 voxel 대화 콘셉트도 보존되어 있습니다. `START_LUNA.cmd`는 기존 사용자 호환을 위해 새 실행 파일로 연결됩니다.

## 공식 참고 자료

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)

현재 보존 지점과 복구 지침은 [SAVEPOINT.md](SAVEPOINT.md)를 먼저 확인하세요.
