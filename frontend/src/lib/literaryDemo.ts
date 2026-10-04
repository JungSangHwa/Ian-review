import { createDocument } from './actions'
import { logActivity, uid, type GlossaryEntry, type Workspace } from './model'
import { validateWorkspace } from './validation'
import { parseSubtitles } from './subtitles'
import { glossaryIdentity } from './glossary'
export const LITERARY_SEED_ID = 'ian-story-glossary-v1'
export const DEMO_WORK = '별빛 서약'
export const LITERARY_TERMS: Omit<GlossaryEntry, 'id'>[] = [
  { source: 'Serin', target: '세린', aliases: ['Lady Serin'], variants: ['셀린', '세린느'], category: 'character', note: '성휘 기사단장. Kael은 세린에게 존댓말을 사용합니다.' },
  { source: 'Kael', target: '카엘', variants: ['케일', '카일'], category: 'character', note: '견습 기사. 세린은 카엘에게 하대하되 모욕적인 어조는 쓰지 않습니다.' },
  { source: 'Moonspire', target: '월광첨탑', variants: ['문스파이어', '달빛탑'], category: 'place', note: '기사단이 지키는 탑. 회차와 자막에서 같은 지명을 사용합니다.' },
  { source: 'Starward Order', target: '성휘 기사단', aliases: ['the Order'], variants: ['별빛 기사단', '성광 기사단'], category: 'place', note: 'the Order도 이 조직을 가리킬 때 성휘 기사단으로 옮깁니다.' },
  { source: 'Commander', target: '단장님', variants: ['사령관님', '지휘관님'], category: 'title', note: '이 예제의 직접 대화에서는 세린을 부르는 존칭입니다. 서술문의 직함은 문맥을 검토하세요.' },
  { source: 'oathstone', target: '서약석', variants: ['맹세의 돌', '맹약석'], category: 'term', note: '서약을 저장하는 유물. 일반적인 돌과 구별되는 설정어입니다.' },
  { source: 'Starfall', target: '성락', variants: ['별의 추락', '스타폴'], category: 'term', note: '세계관의 재난 이름. 단순히 별이 떨어지는 묘사와 구별합니다.' },
  { source: 'By the stars', target: '별들에 맹세코', variants: ['별에 걸고', '별을 두고 맹세하건대'], category: 'phrase', note: '기사단의 반복 맹세 표현. 어미와 문장부호는 문맥에 맞춥니다.' },
].map(t => ({ ...t, sourceLang: 'en', targetLang: 'ko', severity: 'warning', project: DEMO_WORK } as Omit<GlossaryEntry, 'id'>))
export const NOVEL_CHAPTERS = [
  { title: '[작품 예제] 01화 · 월광첨탑의 문', pairs: [
    { source: 'Serin stood before the gates of Moonspire.', target: '셀린은 문스파이어의 성문 앞에 섰다.' },
    { source: 'Kael hurried after her, the oathstone cold in his hand.', target: '케일은 차가운 맹세의 돌을 손에 쥔 채 그녀를 뒤따라 달렸다.' },
    { source: '"Commander, the Starward Order is waiting," Kael said.', target: '"사령관님, 별빛 기사단이 기다리고 있습니다." 카엘이 말했다.' },
    { source: '"By the stars, we will return," Serin answered.', target: '"별에 걸고, 우리는 돌아올 거야." 세린이 대답했다.' },
    { source: 'The scars of Starfall still marked the stone walls.', target: '별의 추락이 남긴 상처가 아직 돌벽에 새겨져 있었다.' },
    { source: 'Serin nodded to Kael. Serin had not forgotten his promise.', target: '세린은 카엘에게 고개를 끄덕였다. 셀린은 그의 약속을 잊지 않았다.' },
  ] },
  { title: '[작품 예제] 02화 · 이어지는 서약', pairs: [
    { source: 'At dawn, Lady Serin returned to Moonspire.', target: '새벽에 세린느는 달빛탑으로 돌아왔다.' },
    { source: 'Kael placed the oathstone on the table.', target: '카일은 맹약석을 탁자 위에 올려놓았다.' },
    { source: 'The Order had survived Starfall, but not without a cost.', target: '성광 기사단은 스타폴을 견뎌 냈지만 대가가 없었던 것은 아니다.' },
    { source: '"Commander, may I stay?" Kael asked.', target: '"지휘관님, 제가 남아도 되겠습니까?" 케일이 물었다.' },
    { source: 'Serin smiled. "By the stars, you already belong here."', target: '세린이 미소 지었다. "별들에 맹세코, 너는 이미 이곳의 일원이야."' },
    { source: 'Beyond Moonspire, the first light touched the forest.', target: '월광첨탑 너머로 첫 햇살이 숲을 비추었다.' },
  ] },
]
export const SUBTITLE_SOURCE = `1
00:00:01,000 --> 00:00:03,200
Commander, we have reached Moonspire.

2
00:00:03,400 --> 00:00:05,500
Kael, keep the oathstone close.

3
00:00:05,700 --> 00:00:08,000
Serin, the Starward Order needs you.

4
00:00:08,300 --> 00:00:10,600
We survived Starfall together.

5
00:00:11,000 --> 00:00:13,000
By the stars, I will not run.

6
00:00:13,300 --> 00:00:15,800
Kael, look at me.
The oathstone is safe.

7
00:00:16,000 --> 00:00:18,200
Serin is waiting at Moonspire.

8
00:00:18,500 --> 00:00:21,000
The Order will remember this night.
`
export const SUBTITLE_TARGETS = ['사령관님, 달빛탑에 도착했습니다.', '케일, 맹세의 돌을 잘 간직해.', '셀린, 성광 기사단에는 당신이 필요해요.', '우리는 함께 스타폴을 견뎌 냈어.', '별에 걸고, 도망치지 않겠습니다.', '카일, 나를 봐.\n맹약석은 무사해.', '세린느가 문스파이어에서 기다리고 있습니다.', '별빛 기사단은 오늘 밤을 기억할 것이다.']
export function hasLiteraryExamples(state: Workspace) { return state.translations.some(d => d.domain === DEMO_WORK && d.title.startsWith('[작품 예제]')) }
export function loadLiteraryExamples(state: Workspace) {
  if (hasLiteraryExamples(state)) throw new Error('웹소설·자막 예제가 이미 있습니다.')
  const draft = structuredClone(state)
  for (const term of LITERARY_TERMS) if (!draft.glossary.some(t => glossaryIdentity(t) === glossaryIdentity(term))) draft.glossary.push({ ...term, id: uid() })
  for (const chapter of NOVEL_CHAPTERS) {
    const id = createDocument(draft, { ...chapter, domain: DEMO_WORK, sourceLang: 'en', targetLang: 'ko', contentType: 'novel' })
    draft.translations.find(d => d.id === id)!.isDemo = true
  }
  const subtitles = parseSubtitles(SUBTITLE_SOURCE, 'srt')
  const id = createDocument(draft, { title: '[작품 예제] 영상 01 · 성문 앞의 대화', domain: DEMO_WORK, sourceLang: 'en', targetLang: 'ko', contentType: 'subtitle', subtitle: subtitles.subtitle, pairs: subtitles.pairs.map((p,i) => ({ ...p, target: SUBTITLE_TARGETS[i] })) })
  draft.translations.find(d => d.id === id)!.isDemo = true
  logActivity(draft, '웹소설 2회차·자막 8구간과 작품 용어 8개를 불러왔습니다. 번역 초안은 ChatGPT가 작성한 혼용 사례입니다.')
  Object.assign(state, validateWorkspace(draft))
}
