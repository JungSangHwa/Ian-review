# 안개항의 마지막 종

실종된 아버지의 목소리를 따라간 수리공 나라가 도시의 안전과 잊힌 이름 사이의 거래를 발견하는 창작 미스터리 판타지다. 3회차·24문단의 영어 원고를 실제 Ollama로 처리하고, 모델 용어집의 표기를 유지하며 Codex가 추가 교정했다.

- [최종 한국어 소설](novel-ko.md)
- [영어 원고](original-novel.md)
- [모델 용어집](model-glossary.md)
- [처리 과정과 발견한 문제](../../docs/REAL_NOVEL_TEST_2026-10-04.md)

## 앱에서 다시 진행하기

1. 새 프로젝트를 만들고 로컬 Ollama 모델을 연결한다. 실제 실행의 최종 모델은 `gemma4:12b`였다. 사용 가능한 설치 모델을 선택할 수 있다.
2. `source.json`의 `instructions`를 작품 공통 번역 메모에 넣는다.
3. `documents`의 각 회차 제목과 `paragraphs`를 등록한다. 문단 사이에 빈 줄을 넣으면 회차당 8문단이 된다. 영어 → 한국어를 선택한다.
4. 모델 용어집 생성·검증을 실행하고 회차 순서대로 번역한다. 새로 생성한 용어와 번역은 이 기록과 다를 수 있다.
5. 결과를 원문과 비교한다. `novel-ko.md`는 Ollama 출력에 Codex의 의미·말투 교정을 더한 최종본이다.

`final-documents.json`과 `ollama-before-postedit.json`은 실제 UI에서 읽은 최종본과 교정 전 모델 결과다. 앱의 전체 작업 공간 복원용 JSON 형식은 아니다. `live-glossary.json`은 UI에서 읽은 기준 용어와 원문 근거다.

## 기록 검증

프로젝트 루트에서 실행한다.

```sh
node --require ./frontend/scripts/register-ts.cjs examples/novel-harbor/verify.cjs
```

최종 원문 24문단의 일치, 기준 용어·수량 규칙, 완료 상태와 용어 인용 근거를 확인한다. 의미·문학적 품질을 자동 인증하는 검사는 아니다.
