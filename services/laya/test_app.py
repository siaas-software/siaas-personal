"""HTTP contract tests with a simulated classifier; no model download or accuracy claim."""
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

os.environ['SIAAS_RESEARCH_TOKEN'] = 'test-token-' * 4
class Router:
    result = types.SimpleNamespace(values={'coverage':'sufficient','needsFreshness':False}, answer_confidence={'coverage':0.95,'needsFreshness':0.99}, usage=None)
    def __init__(self, **kwargs): pass
    def decide(self, *args, **kwargs): return self.result
sys.modules['laya'] = types.SimpleNamespace(Router=Router)
spec = importlib.util.spec_from_file_location('laya_adapter', Path(__file__).with_name('app.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(module.app)
        self.client.__enter__()
        self.headers = {'Authorization':'Bearer '+os.environ['SIAAS_RESEARCH_TOKEN']}
        self.body = {'question':'Domanda','evidence':[{'title':'Titolo','text':'Passaggio','kind':'document'}],'date':'2026-10-12'}
        module.router.result = Router.result
    def tearDown(self): self.client.__exit__(None,None,None)
    def test_auth_and_health(self):
        self.assertEqual(self.client.get('/health').status_code,401)
        self.assertTrue(self.client.get('/health',headers=self.headers).json()['ok'])
    def test_schema_and_body_bounds(self):
        self.assertEqual(self.client.post('/assess',json={},headers=self.headers).status_code,422)
        self.assertEqual(self.client.post('/assess',content='x'*40001,headers=self.headers).status_code,413)
    def test_typed_decision_and_empty_evidence(self):
        response=self.client.post('/assess',json=self.body,headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json(),{'coverage':'sufficient','needsFreshness':False,'uncertain':False})
        self.body['evidence']=[]
        self.assertEqual(self.client.post('/assess',json=self.body,headers=self.headers).json()['coverage'],'insufficient')
    def test_abstains_on_truncation_or_low_score(self):
        for score,truncated in [(0.6,False),(0.99,True)]:
            module.router.result=types.SimpleNamespace(values=Router.result.values,answer_confidence={'coverage':score,'needsFreshness':0.99},usage={'truncated':truncated})
            self.assertTrue(self.client.post('/assess',json=self.body,headers=self.headers).json()['uncertain'])
    def test_concurrent_inference_fails_fast(self):
        module.inference_lock.acquire()
        try:self.assertEqual(self.client.post('/assess',json=self.body,headers=self.headers).status_code,503)
        finally:module.inference_lock.release()

if __name__=='__main__': unittest.main()
