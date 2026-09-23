import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch
import tempfile
import json
spec=importlib.util.spec_from_file_location('repair',Path(__file__).resolve().parents[1]/'scripts/repair-google-login.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class RepairTests(unittest.TestCase):
    def test_target_preserved(self): self.assertEqual(r.target({}),(r.KNOWN_PROJECT,r.KNOWN_DATABASE))
    def test_conflicting_project_stops(self):
        with self.assertRaises(r.Stop) as error:r.target({'FIREBASE_CONFIG':{'value':'{"projectId":"other-project"}'}})
        self.assertEqual(error.exception.code,'DB_TARGET_MISMATCH')
    def test_secret_reference_not_read(self):
        with self.assertRaises(r.Stop):r.target({'FIREBASE_SERVICE_ACCOUNT_JSON':{'valueFrom':{'secretKeyRef':{'key':'latest'}}}})
    def test_exact_database_condition(self):
        c=r.condition_for('old-project','named-db');self.assertEqual(c['expression'],'resource.name=="projects/old-project/databases/named-db"')
    def test_director_read_is_masked_and_nonmutating(self):
        def response(url,token=None):
            if '/documents/' not in url:return 200,{'type':'FIRESTORE_NATIVE'}
            self.assertIn('mask.fieldPaths=role',url);self.assertNotIn('password',url)
            return 200,{'documents':[{'fields':{'role':{'stringValue':'director'}}}]}
        with patch.object(r,'get_json',response):self.assertTrue(r.has_director('old-project','named-db','not-a-real-token'))
    def test_missing_director_false(self):
        with patch.object(r,'get_json',side_effect=[(200,{'type':'FIRESTORE_NATIVE'}),(200,{'documents':[]})]):self.assertFalse(r.has_director('old-project','named-db','unused'))
    def test_google_denies_iam_no_escalation(self):
        result=types.SimpleNamespace(returncode=1,stderr='PERMISSION_DENIED secret marker',stdout='')
        with patch.object(r.subprocess,'run',return_value=result) as call:
            with self.assertRaises(r.Stop) as error:r.gcloud('projects','get-iam-policy','old-project')
            self.assertNotIn('secret marker',error.exception.message);self.assertEqual(call.call_count,1)
    def test_apply_only_conditional_binding_and_no_restart(self):
        commands=[];r.REPORT={'changes':[]}
        def fake(*args,**kw):
            commands.append(args)
            if args[:2]==('auth','list'):return [{'account':'owner@example.com'}]
            if args[:3]==('run','services','describe'):return {'metadata':{'name':r.SERVICE},'status':{'traffic':[{'percent':100,'revisionName':'in-hanh-tinh-xanh-001'}]}}
            if args[:3]==('run','revisions','describe'):return {'spec':{'serviceAccountName':'runtime@run-project.iam.gserviceaccount.com','containers':[{'env':[]}]}}
            if args[:2]==('logging','read'):return [{'textPayload':'7 PERMISSION_DENIED firestore data'}]
            if args[:2]==('auth','print-access-token'):return 'private-test-token'
            if args[:2]==('projects','get-iam-policy'):return {'etag':'original','bindings':[]}
            if args[:2]==('projects','add-iam-policy-binding'):
                self.assertIn('--role=roles/datastore.user',args)
                filename=next(a.split('=',1)[1] for a in args if a.startswith('--condition-from-file='))
                self.assertIn(r.KNOWN_DATABASE,json.loads(Path(filename).read_text())['expression']);return {}
            raise AssertionError(args)
        with tempfile.TemporaryDirectory() as d,patch.object(r,'gcloud',fake),patch.object(r.shutil,'which',return_value='/gcloud'),patch.object(r,'health',side_effect=[{'ok':False,'version':'30.0.0'},{'ok':True,'version':'30.0.0'}]),patch.object(r,'has_director',return_value=True),patch.object(r.Path,'home',return_value=Path(d)),patch.object(r.time,'sleep'):
            r.main(types.SimpleNamespace(project='run-project',apply_iam=True))
        mutations=[x for x in commands if 'add-iam-policy-binding' in x];self.assertEqual(len(mutations),1)
        self.assertFalse(any('update' in x or 'deploy' in x or 'create' in x or 'delete' in x for x in commands))
        self.assertEqual(r.REPORT['result'],'DATABASE_HEALTHY_AFTER_IAM')
if __name__=='__main__':unittest.main()
