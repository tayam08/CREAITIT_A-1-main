# 면접용_로컬_챗_v1 · 채용 로그 연동

2026-09-01T23:26:47+09:00 기준 검증된 통합 릴리스다. 동의한 LUNA 대화는 세션 단위로 저장되며, 지원서 서명 초대 링크가 있는 종료 세션은 전용 수신 Worker를 거쳐 채용 시스템에 연결된다. 원문은 비공개 R2, 비식별 요약은 Workers AI, 메타데이터와 감사 기록은 D1에 저장한다. 관리자 사이트의 Cloudflare Access와 로컬 app-server의 loopback·capability-token·Origin 보안은 유지한다.

검증 결과: 메인 테스트 5/5, 양쪽 린트/빌드/타입검사 통과, 로컬 3000·4500·4502 HTTP 200, Luna `LUNA-LIVE`, 수신 API 잘못된 토큰 401, 유효 서명 토큰 지원서 조회 단계 통과.

상세 기록과 artifact manifest는 `SAVEPOINT.md` 및 `docs/savepoints/latest.json`을 따른다.
