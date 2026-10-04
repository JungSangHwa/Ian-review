"""Browser regression tests for the current local project workflow.
Run after `npm run build`: python -m pip install -r tests/requirements.txt;
python -m playwright install chromium; python tests/e2e.py.
The model responses below are deterministic test doubles. Real Ollama is not required.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import unittest
from urllib.parse import quote
from urllib.request import urlopen
from urllib.error import URLError
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
BASE = 'http://127.0.0.1:4173'

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = None
        try:
            with urlopen(BASE, timeout=2) as response:
                if response.status != 200 or b'Ian' not in response.read():
                    raise RuntimeError('Port 4173 is occupied by a different application.')
        except (URLError, TimeoutError):
            cls.server = subprocess.Popen(['node', 'start.mjs', '--no-open'], cwd=ROOT, stdout=subprocess.DEVNULL)
            for _ in range(40):
                try:
                    with urlopen(BASE, timeout=1) as response:
                        if response.status == 200: break
                except URLError:
                    time.sleep(.2)
            else:
                raise RuntimeError('Ian local server did not start.')
        cls.pw = sync_playwright().start()
        executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or shutil.which('chromium')
        if not executable and os.name == 'nt':
            chrome = Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe')
            if chrome.exists(): executable = str(chrome)
        args = {'headless': True, 'args': ['--no-sandbox']}
        if executable: args['executable_path'] = executable
        cls.browser = cls.pw.chromium.launch(**args)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()
        if cls.server:
            cls.server.terminate(); cls.server.wait(timeout=5)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        self.page = self.context.new_page()
        self.page.set_default_timeout(8000)
        self.errors, self.external = [], []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('request', lambda request: self.external.append(request.url) if request.url.startswith(('http:', 'https:')) and not request.url.startswith(BASE) else None)
        self.page.goto(BASE, wait_until='networkidle')
        expect(self.page.get_by_role('heading', name='프로젝트별 번역 작업')).to_be_visible()

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'Uncaught browser errors')
        self.assertEqual(self.external, [], 'Unexpected browser network requests')

    def path(self, project, suffix=''):
        return BASE + '/projects/' + quote(project, safe='') + ('/' + suffix if suffix else '')

    def create_project(self, name):
        p = self.page
        p.goto(BASE)
        p.get_by_label('새 프로젝트 이름').fill(name)
        p.get_by_role('button', name='프로젝트 만들기', exact=True).click()
        expect(p).to_have_url(self.path(name))

    def create_document(self, project, title='01화', source='Mira entered.', target=''):
        p = self.page
        p.goto(self.path(project, 'documents/new'))
        p.get_by_label('회차 / 파일 제목').fill(title)
        p.locator('#source-text').fill(source)
        p.locator('#target-text').fill(target)
        p.get_by_role('button', name='저장하고 용어 확인').click()
        expect(p.get_by_role('textbox', name='번역문 편집')).to_be_visible()
        return p.url

    def mock_model(self, term=False, hold_translation=None):
        def handler(route):
            body = route.request.post_data_json
            system = body.get('system', '')
            if system.startswith('Build') or system.startswith('Independently'):
                samples = json.loads(body['prompt'])['samples']
                terms = []
                if term:
                    sample = next(s for s in samples if 'Mira' in s['source'])
                    terms = [{'source': 'Mira', 'target': '미라', 'category': 'character', 'aliases': [], 'note': '등장인물', 'evidence': {'documentId': sample['documentId'], 'segmentId': sample['segmentId'], 'quote': 'Mira'}}]
                route.fulfill(json={'text': json.dumps({'terms': terms})})
            elif system.startswith('You translate') or system.startswith('You are the second-pass'):
                payload = json.loads(body['prompt'])
                segments = payload['segments'] if 'segments' in payload else payload['request']['segments']
                if hold_translation is not None and system.startswith('You translate') and hold_translation['hold']:
                    hold_translation['pending'].append((route, segments))
                    return
                route.fulfill(json={'text': json.dumps({'segments': [{'id': s['id'], 'target': '모델이 저장한 번역'} for s in segments], 'terms': []})})
            else:
                raise AssertionError('Unexpected model request: ' + system[:80])
        self.page.route('**/api/model', handler)
        self.page.route('**/api/models', lambda route: route.fulfill(json={'models': [{'id': 'local-test', 'label': 'local-test'}]}))
        self.page.route('**/api/model/test', lambda route: route.fulfill(json={'ok': True}))

    def save_model(self, project):
        p = self.page
        p.goto(self.path(project, 'models'))
        p.locator('#model-id').fill('local-test')
        p.get_by_role('button', name='작품 모델 설정 저장').click()
        expect(p.get_by_text('로컬 Ollama · local-test')).to_be_visible()

    def test_project_create_rename_switch_delete_and_legacy_document_project(self):
        p = self.page
        self.create_project('Alpha')
        self.create_project('Beta')
        p.goto(self.path('Alpha'))
        p.get_by_role('button', name='이름 변경').click()
        p.get_by_role('dialog').get_by_label('새 프로젝트 이름').fill('Alpha.v1')
        p.get_by_role('dialog').get_by_role('button', name='이름 변경').click()
        expect(p).to_have_url(self.path('Alpha.v1'))
        p.get_by_label('프로젝트 이름 검색').fill('no match')
        expect(p.locator('#project-switch')).to_have_value('Alpha.v1')
        p.get_by_label('프로젝트 이름 검색').fill('Beta')
        p.locator('#project-switch').select_option('Beta')
        expect(p).to_have_url(self.path('Beta'))
        p.get_by_role('button', name='프로젝트 삭제').click()
        p.get_by_role('dialog').get_by_role('button', name='삭제', exact=True).click()
        expect(p).to_have_url(BASE + '/')
        self.assertNotIn('Beta', p.locator('#project-switch').locator('option').all_text_contents())
        p.goto(BASE + '/documents/new')
        p.get_by_label('작품 이름').fill('문서에서 만든 작품')
        p.get_by_label('회차 / 파일 제목').fill('첫 회차')
        p.locator('#source-text').fill('Hello.')
        p.get_by_role('button', name='저장하고 용어 확인').click()
        p.goto(self.path('문서에서 만든 작품', 'documents'))
        p.get_by_role('button', name='첫 회차 삭제').click()
        p.get_by_role('dialog').get_by_role('button', name='삭제', exact=True).click()
        p.goto(BASE)
        expect(p.get_by_role('link', name=re.compile('문서에서 만든 작품'))).to_be_visible()

    def test_project_scoped_documents_terms_and_sidebar_counts(self):
        p = self.page
        self.create_project('Alpha'); self.create_document('Alpha', source='Mira entered.')
        self.create_project('Beta'); self.create_document('Beta', source='Juno entered.')
        p.goto(self.path('Alpha', 'glossary'))
        p.get_by_text('용어 직접 편집 · CSV 가져오기/내보내기', exact=True).click()
        p.locator('#main-content').get_by_role('button', name='용어 추가', exact=True).click()
        p.get_by_role('dialog').get_by_label('원어 *').fill('Mira')
        p.get_by_role('dialog').get_by_label('기준 번역 *').fill('미라')
        p.get_by_role('dialog').get_by_role('button', name='기준 번역 저장').click()
        expect(p.get_by_text('Mira', exact=True)).to_be_visible()
        expect(p.get_by_role('navigation', name='주요 메뉴').get_by_role('link', name='원고·자막')).to_contain_text('1')
        p.locator('#project-switch').select_option('Beta')
        expect(p).to_have_url(self.path('Beta', 'glossary'))
        self.assertEqual(p.get_by_text('Mira', exact=True).count(), 0)
        expect(p.get_by_role('navigation', name='주요 메뉴').get_by_role('link', name='프로젝트 용어집')).to_contain_text('0')

    def test_model_draft_navigation_guard_and_connection_state(self):
        p = self.page
        self.create_project('Alpha'); self.create_document('Alpha')
        self.mock_model(term=True)
        self.save_model('Alpha')
        expect(p.locator('.sidebar-model')).to_contain_text('연결 미확인')
        pending_models = []
        p.route('**/api/models', lambda route: pending_models.append(route))
        p.get_by_role('button', name='설치된 모델 불러오기').click()
        for _ in range(50):
            if pending_models: break
            p.wait_for_timeout(100)
        self.assertTrue(pending_models)
        p.get_by_role('button', name='모델 연결 확인').click()
        expect(p.locator('.sidebar-model')).to_contain_text('마지막 연결 확인 성공')
        pending_models[0].fulfill(json={'models': [{'id': 'local-test', 'label': 'local-test'}]})
        expect(p.get_by_role('button', name='설치된 모델 불러오기')).to_be_enabled()
        p.goto(self.path('Alpha', 'glossary'))
        p.get_by_role('button', name='모델로 용어집 생성·검증').click()
        expect(p.get_by_text('모델 생성 · 적용 중', exact=True)).to_be_visible()
        p.goto(self.path('Alpha', 'models'))
        memo = p.get_by_label('작품 공통 번역 메모')
        memo.fill('저장하지 않은 번역 메모')
        expect(memo).to_have_value('저장하지 않은 번역 메모')
        p.once('dialog', lambda dialog: dialog.dismiss())
        p.get_by_role('navigation', name='주요 메뉴').get_by_role('link', name='프로젝트 용어집').click()
        expect(memo).to_have_value('저장하지 않은 번역 메모')

    def test_sidebar_review_filter_recent_document_and_pin_persist(self):
        p = self.page
        self.create_project('Alpha'); self.create_document('Alpha')
        self.mock_model(term=True)
        self.save_model('Alpha')
        p.goto(self.path('Alpha', 'glossary'))
        p.get_by_role('button', name='모델로 용어집 생성·검증').click()
        expect(p.locator('.sidebar-task')).to_contain_text('완료')
        expect(p.locator('.sidebar-task').get_by_role('link', name='용어집 열기')).to_be_visible()
        self.assertEqual(p.locator('.sidebar-task').get_by_role('button', name='재개').count(), 0)
        expect(p.get_by_text('모델 생성 · 적용 중', exact=True)).to_be_visible()
        review = p.get_by_role('navigation', name='주요 메뉴').get_by_role('link', name='이전 용어 검증')
        expect(review).to_contain_text('0')
        self.assertEqual(p.get_by_role('button', name=re.compile('승인|확정')).count(), 0)
        expect(p.get_by_text('원문 근거: “Mira”')).to_be_visible()
        with p.expect_download() as event:
            p.get_by_role('button', name='기준 문서 다운로드').click()
        self.assertTrue(event.value.suggested_filename.endswith('-번역기준.md'))
        review.click()
        expect(p).to_have_url(self.path('Alpha', 'glossary') + '?review=1')
        expect(p.get_by_text('모델 검증 대기 용어가 없습니다', exact=True)).to_be_visible()
        self.create_document('Alpha', title='02화', source='First scene.\n\nSecond scene.')
        p.get_by_role('button', name='다음 문단').click()
        expect(p.locator('.source-content')).to_have_text('Second scene.')
        p.goto(self.path('Alpha', 'documents'))
        p.locator('.sidebar-recent').get_by_role('link', name=re.compile('02화')).click()
        expect(p.locator('.source-content')).to_have_text('Second scene.')
        p.goto(self.path('Alpha', 'documents'))
        p.get_by_role('link', name=re.compile('01화')).first.click()
        recent = p.locator('.sidebar-recent')
        expect(recent.get_by_role('link', name=re.compile('01화'))).to_be_visible()
        p.get_by_role('button', name='☆ 이 프로젝트 고정').click()
        p.reload()
        expect(p.get_by_role('button', name='★ 고정 해제')).to_be_visible()
        expect(recent.get_by_role('link', name=re.compile('01화'))).to_be_visible()
        p.goto(self.path('Alpha'))
        p.get_by_role('button', name='이름 변경').click()
        p.get_by_role('dialog').get_by_label('새 프로젝트 이름').fill('Alpha.v2')
        p.get_by_role('dialog').get_by_role('button', name='이름 변경').click()
        expect(p.get_by_role('button', name='★ 고정 해제')).to_be_visible()
        expect(p.locator('.sidebar-recent')).to_contain_text('01화')

    def test_unsaved_manual_draft_survives_model_result(self):
        p = self.page
        self.create_project('Alpha'); self.create_document('Alpha')
        held = {'hold': True, 'pending': []}
        self.mock_model(hold_translation=held)
        self.save_model('Alpha')
        p.goto(self.path('Alpha', 'documents'))
        p.get_by_role('link', name=re.compile('01화')).first.click()
        p.get_by_role('button', name='용어집 기반 모델 번역').click()
        p.get_by_role('dialog').get_by_role('button', name=re.compile('빈 번역')).click()
        for _ in range(50):
            if held['pending']: break
            p.wait_for_timeout(100)
        self.assertTrue(held['pending'], 'translation request did not reach the model double')
        editor = p.get_by_role('textbox', name='번역문 편집')
        editor.fill('사람이 작성 중인 초안')
        held['hold'] = False
        route, segments = held['pending'].pop(0)
        route.fulfill(json={'text': json.dumps({'segments': [{'id': s['id'], 'target': '모델이 저장한 번역'} for s in segments], 'terms': []})})
        expect(editor).to_have_value('사람이 작성 중인 초안')
        expect(p.get_by_text('모델 결과 도착 · 수동 초안 보존')).to_be_visible()
        p.on('dialog', lambda dialog: dialog.accept())
        p.get_by_role('button', name=re.compile('변경 저장')).click()
        expect(editor).to_have_value('사람이 작성 중인 초안')
        p.get_by_role('button', name=re.compile('수정 이력')).click()
        expect(p.get_by_role('dialog')).to_contain_text('모델이 저장한 번역')

    def test_job_keeps_running_after_page_move_and_can_pause_resume(self):
        p = self.page
        self.create_project('Alpha'); self.create_document('Alpha')
        held = {'hold': True, 'pending': []}
        self.mock_model(hold_translation=held)
        self.save_model('Alpha')
        p.goto(self.path('Alpha', 'documents'))
        p.get_by_role('link', name=re.compile('01화')).first.click()
        p.get_by_role('button', name='용어집 기반 모델 번역').click()
        p.get_by_role('dialog').get_by_role('button', name=re.compile('빈 번역')).click()
        for _ in range(50):
            if held['pending']: break
            p.wait_for_timeout(100)
        self.assertTrue(held['pending'])
        p.get_by_role('navigation', name='주요 메뉴').get_by_role('link', name='원고·자막', exact=True).click()
        expect(p).to_have_url(self.path('Alpha', 'documents'))
        expect(p.locator('.sidebar-task')).to_contain_text('번역 생성 중')
        p.locator('.sidebar-task').get_by_role('button', name='일시 중지').click()
        expect(p.locator('.sidebar-task')).to_contain_text('일시 중지')
        for route, _ in held['pending']:
            try: route.abort()
            except Exception: pass
        held['pending'].clear()
        held['hold'] = False
        p.locator('.sidebar-task').get_by_role('button', name='재개').click()
        p.locator('.sidebar-task').get_by_role('link', name='작업 열기').click()
        expect(p.get_by_role('textbox', name='번역문 편집')).to_have_value('모델이 저장한 번역')
        expect(p.get_by_text('번역 완료', exact=True)).to_be_visible()

    def test_mobile_switch_keyboard_and_download_paths(self):
        p = self.page
        self.create_project('Alpha'); self.create_project('Beta')
        self.context.set_default_timeout(8000)
        p.set_viewport_size({'width': 390, 'height': 600})
        p.goto(self.path('Alpha'))
        p.get_by_role('button', name='메뉴 열기').click()
        expect(p.locator('.sidebar')).to_have_class(re.compile('is-open'))
        p.locator('#project-switch').select_option('Beta')
        expect(p).to_have_url(self.path('Beta'))
        expect(p.locator('.sidebar')).not_to_have_class(re.compile('is-open'))
        p.get_by_role('button', name='메뉴 열기').click()
        p.keyboard.press('Escape')
        expect(p.locator('.sidebar')).not_to_have_class(re.compile('is-open'))
        p.get_by_role('button', name='메뉴 열기').click()
        with p.expect_download() as download:
            p.get_by_role('button', name=re.compile('전체 백업')).click()
        self.assertTrue(download.value.suggested_filename.endswith('.json'))
        for path, content_type in [('/projects/QA.v1', 'text/html'), ('/projects/QA.v1/glossary', 'text/html'), ('/home', 'text/html'), ('/evaluation/demo', 'text/html'), ('/examples/novel-before.csv', 'text/csv'), ('/examples/subtitle-source.srt', 'application/x-subrip'), ('/validation/errors.csv', 'text/csv')]:
            with urlopen(BASE + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(content_type, response.headers['Content-Type'])
                self.assertTrue(response.read())
        for path in ['/src/lib/model.ts', '/assets/missing.js', '/projects/QA.v1/source.js']:
            with self.assertRaises(Exception): urlopen(BASE + path)

if __name__ == '__main__':
    unittest.main(verbosity=2)
