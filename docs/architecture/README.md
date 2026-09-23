# Architecture Documentation

System context, trust boundaries, data flows, deployment topology, and Architecture Decision Records belong here. Security-sensitive decisions must link to the threat model.

- [인증 백엔드 아키텍처](backend-authentication.ko.md): opaque session, server-owned PKCE, 14-route same-origin BFF, interaction binding과 recovery/session race를 설명합니다.
- [프론트엔드 구현 구조](frontend.ko.md): 화면·컴포넌트·ky·TanStack Query와 아직 없는 금융/모바일 기능을 구분합니다.
- [초급 개발자 코드 읽기](../guides/code-reading.ko.md): 함수, 매개변수, 계약, 실제 로그인 요청의 흐름을 설명합니다.
- [문서 전체 지도](../README.md): 최신 설계와 구현 상태를 분야별로 찾습니다.
