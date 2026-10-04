# 실제 Ollama 통합 테스트 — 2026-10-04

현재 앱 브라우저에 테스트 프로젝트를 만들고, 설치된 로컬 Ollama 모델 qwen2.5:14b로 실제 추론을 실행했습니다. 기존 별빛 서약 프로젝트는 변경하지 않았습니다.

## 결과

| 항목 | 결과 |
|---|---|
| 완료 프로젝트 | Ollama 통합 테스트 · 수정 검증 |
| 입력 | 영어 원고 2회차 × 3문단 + SRT 1개 × 3자막 |
| 모델 용어집 | 생성·검증 2묶음, 기준 용어 8개, 사람 승인 대기 없음 |
| 모델 번역·재검증 | 9/9구간 저장, 세 문서 검수 완료, 미처리 규칙 이슈 0개 |
| 용어 일관성 | 모델이 정한 인명·호칭·지명·단체·열쇠 표기를 회차와 자막에서 동일하게 사용 |
| 원문·변수 | 9구간 원문 불변, {chapter_id} 보존 |
| 자막 구조 | 원본 3개 시간표, 2·2·1줄 구조, <i> 태그 보존 |
| 지속성 | 세 문서의 새 페이지 로드/새로고침 후 저장된 번역 일치 |
| 코드 검증 | TypeScript·ESLint·빌드 통과, 단위 테스트 182/182, 브라우저 회귀 7/7 |
| 실행 서버 | http://127.0.0.1:4173, HTTP 200 유지 |

## 발견하고 수정한 문제

1. **인명과 호칭을 같은 번역으로 합침.** 초기 모델은 Mira의 aliases에 Ash Warden을 넣고 호칭 번역을 인명 변형으로 기록했습니다. 실제 번역에서도 호칭이 미라로 소실됐습니다. 이름·호칭·전체 이름은 번역 문구가 다르면 별도 항목으로 만들도록 모델 지시를 바꿨습니다. 저장 로직은 정식 원어를 먼저 찾고, 다른 분류의 호칭을 인명으로 합치지 않습니다. 이미 별도 기준이 있는 표현은 서로의 별칭에서 제외합니다. 공통 용어 변경은 해당 프로젝트의 재정의로 처리해 다른 프로젝트를 보존합니다. 수정 후 Mira, Mira Vale, Ash Warden이 각 기준 문구로 저장됐습니다.
2. **검증 모델이 빠진 용어를 보완하면 전체 중단.** 초기 실행은 “검증 모델이 원래 제안에 없는 용어를 추가했습니다.”로 0/3구간에서 중단됐습니다. 보완 용어도 같은 원문 인용·구간 ID·형식·상한 검사를 통과하면 저장하도록 수정했습니다. 원문에 없는 근거는 계속 거절합니다. 기존 중단 작업도 수정 후 재개·저장됐습니다.
3. **영문 수사 숫자 오탐.** ten years → 10년을 원문 숫자 없음/번역 숫자 10 차이로 표시했습니다. 영어의 명확한 기수와 복합 수를 숫자로 비교하도록 수정했습니다. 수량 불일치와 반복 횟수 검사는 유지하고, 대명사로도 쓰는 단독 one은 이 문자 기반 검사에서 제외했습니다.
4. **자막 줄바꿈이 사라져도 완료 처리.** 원문의 두 줄을 모델이 한 줄로 합친 결과가 확인 완료로 저장됐습니다. 번역과 재검증 응답을 저장하기 전에 줄 수·태그·구간 구분자 검사를 수행하고, 잘못된 응답은 기존의 최대 2회 모델 수정 요청으로 보완합니다. 수동 자막에도 같은 구조 검사를 적용합니다. 수정 후 두 줄 자막과 <i> 태그가 보존됐습니다.

평범한 행동 문장 추출과 근거 없는 맥락 메모를 줄이도록 모델 지시도 보강했습니다. 수정 후 Mira nodded는 기준 용어에서 제외됐습니다. 모델이 원문 맥락으로 표기를 결정했고 사람이 번역 용어를 지정하지 않았습니다.

## 확인 자료

- [입력 원고·자막](../output/playwright/ollama-integration/source-fixtures.json)
- [앱 화면에서 읽은 저장 번역](../output/playwright/ollama-integration/live-documents.json)
- [앱 화면에서 읽은 용어집](../output/playwright/ollama-integration/live-glossary.json)
- [원문·용어·변수·자막 검증 결과](../output/playwright/ollama-integration/result.json)
- [저장 지속성 결과](../output/playwright/ollama-integration/persistence-checks.json)
- [검증 스크립트](../output/playwright/ollama-integration/verify-live.cjs)
- [실제 번역으로 직렬화한 SRT](../output/playwright/ollama-integration/translated-trailer.srt)
- [단위 테스트 로그](../output/playwright/ollama-integration/unit-test.log)
- [브라우저 테스트 로그](../output/playwright/ollama-integration/browser-test.log)
- [세 문서 완료 화면](../output/playwright/ollama-integration/documents-complete.jpg)
- [모델 용어집 화면](../output/playwright/ollama-integration/glossary-complete.jpg)

비교용 초기 재현 데이터는 Ollama 통합 테스트 · 1004에 보존했습니다. 완료 데이터는 수정 검증 프로젝트에 있습니다.

실제 모델 검증은 합성 원고 3문서와 한 모델에 한정합니다. 규칙 이슈 0개는 문학적 표현·단어 선택의 의미 품질 인증이 아닙니다. SRT 결과 파일은 앱 화면에서 확인한 실제 저장 번역과 원본 시간표를 앱의 직렬화 함수에 넣어 검사했습니다. 인앱 브라우저의 다운로드 이벤트는 수신되지 않아 해당 브라우저에서 JSON 백업 파일 저장은 확인하지 못했습니다. Chrome 회귀의 다운로드 검사는 통과했습니다.
