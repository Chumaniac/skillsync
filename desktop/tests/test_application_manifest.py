import hashlib,importlib.util,json,tempfile,unittest
from contextlib import chdir
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('sync_application_manifest',Path(__file__).resolve().parents[1]/'application_manifest.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ManifestTests(unittest.TestCase):
 def fixture(self,root):
  app=root/'SkillSync.app';resources=app/'Contents/Resources';runtime=resources/'runtime';dist=runtime/'app/dist';dist.mkdir(parents=True)
  (resources/'app.json').write_text(json.dumps({'sourceCommit':'a'*40,'includesWorkingTreeChanges':False}))
  (runtime/'app/package.json').write_text(json.dumps({'version':'0.4.1'}))
  (dist/'build-info.json').write_text(json.dumps({'version':'0.4.1','sourceRevision':'a'*40,'dirty':False}))
  files={str(p.relative_to(runtime)):hashlib.sha256(p.read_bytes()).hexdigest() for p in runtime.rglob('*') if p.is_file()}
  (runtime/'runtime-manifest.json').write_text(json.dumps({'sourceCommit':'a'*40,'includesWorkingTreeChanges':False,'minimumSystemVersion':'13.5','architecture':'arm64','files':files}))
  archive=root/'application.zip';archive.write_bytes(b'owned zip fixture');return app,archive,dist
 def test_nonexecuting_same_source_inventory_and_changed_bytes(self):
  with tempfile.TemporaryDirectory() as temporary,chdir(temporary):
   app,archive,dist=self.fixture(Path(temporary))
   with mock.patch('subprocess.Popen',side_effect=AssertionError('must not execute app code')):data=module.create(app,archive)
   self.assertEqual(data['version'],'0.4.1');self.assertFalse(data['notarized'])
   (dist/'changed.txt').write_text('unrecognized file')
   with self.assertRaisesRegex(ValueError,'BYTES_CHANGED'):module.create(app,archive)
 def test_outside_context_and_external_links_fail(self):
  with tempfile.TemporaryDirectory() as temporary,tempfile.TemporaryDirectory() as outside,chdir(temporary):
   app,archive,dist=self.fixture(Path(outside))
   with self.assertRaisesRegex(ValueError,'OUTSIDE_INVOCATION_ROOT'):module.create(app,archive)
   app,archive,dist=self.fixture(Path(temporary));(dist/'link').symlink_to(outside,target_is_directory=True)
   with self.assertRaisesRegex(ValueError,'EXTERNAL_LINK'):module.create(app,archive)
if __name__=='__main__':unittest.main()
