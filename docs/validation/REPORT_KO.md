# Ian 테스트 검증 결과

- 작성·번역·자체 검수: ChatGPT
- 자동 검사: 149/149 통과
- 코퍼스: 수정 전 32/36 → 수정 후 36/36 규칙 기대값 일치
- 구성: 4문서, 36문단, A/B 평가 4개, 용어 4개
- 수정: 음수 부호 탐지, 폭·정밀도 지정 printf 변수 탐지
- 의미 오류 4건: 규칙으로 탐지되지 않음. 수동 이슈·수정안 등록 및 적용
- 올바른 단위 환산 1건: 숫자 경고 발생, 의도된 차이로 무시
- 저장 검증: 실제 앱 저장 어댑터 + fake-indexeddb 메모리 대역, 21개 시나리오
- 실제 브라우저 UI 검증: 미수행(미리보기 인프라 불가)
- A/B 후보는 모두 ChatGPT가 작성. 완료본 점수는 흐름 검증용 합성 값이며 독립 모델 비교가 아님.

일반 회귀 테스트 세트는 데이터 관리에서 선택해 추가합니다. 기본으로 추가되는 웹소설·자막 예제와 구분됩니다. JSON 복원은 현재 작업 공간 전체를 교체합니다.

상세 결과: frontend/public/validation/report.html, results.json
원본 사례: frontend/src/lib/testCorpus.ts
재현: frontend에서 npm test > ../docs/validation/test-run.log 2>&1 성공 후 npm run test:export
