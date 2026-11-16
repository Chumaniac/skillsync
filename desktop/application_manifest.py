"""Inventory an owned SkillSync application without executing its contents."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

def scoped(value):
    root=os.path.realpath(os.getcwd()); value=os.path.realpath(os.path.abspath(os.path.expanduser(value)))
    if value!=root and not value.startswith(root.rstrip(os.sep)+os.sep):raise ValueError('PATH_OUTSIDE_INVOCATION_ROOT')
    return Path(value)
def metadata(path,limit):
    if not path.is_file() or path.is_symlink() or path.stat().st_size>limit:raise ValueError('METADATA_INVALID')
    return json.loads(path.read_text())
def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def create(application,archive):
    application=scoped(application);archive=scoped(archive)
    if not application.is_dir() or application.is_symlink() or not archive.is_file() or archive.is_symlink() or archive.stat().st_size>1024**3:raise ValueError('ARTIFACT_INVALID')
    resources=application/'Contents/Resources';config=metadata(resources/'app.json',16384)
    runtime=metadata(resources/'runtime/runtime-manifest.json',8*1024**2);build=metadata(resources/'runtime/app/dist/build-info.json',16384)
    package=metadata(resources/'runtime/app/package.json',16384);revision=config.get('sourceCommit')
    if runtime.get('architecture') not in {'arm64','x86_64'}:raise ValueError('RUNTIME_ARCHITECTURE_INVALID')
    if not isinstance(revision,str) or not re.fullmatch('[a-f0-9]{40}',revision) or config.get('includesWorkingTreeChanges') is not False or runtime.get('sourceCommit')!=revision or runtime.get('includesWorkingTreeChanges') is not False or build.get('sourceRevision')!=revision or build.get('dirty') is not False or build.get('version')!=package.get('version'):raise ValueError('SOURCE_IDENTITY_MISMATCH')
    files={};total=0
    for file in application.rglob('*'):
        if file.is_symlink():
            if not file.resolve().is_relative_to(application.resolve()):raise ValueError('EXTERNAL_LINK')
            continue
        if not (file.is_file() or file.is_dir()):raise ValueError('SPECIAL_FILE')
        if file.is_file():
            name=str(file.relative_to(application));total+=file.stat().st_size
            if len(files)>=30000 or total>512*1024**2 or len(name.encode())>1024:raise ValueError('ARTIFACT_CAPACITY')
            files[name]=digest(file)
    prefix='Contents/Resources/runtime/'
    actual={name[len(prefix):]:value for name,value in files.items() if name.startswith(prefix) and name!=prefix+'runtime-manifest.json'}
    if actual!=runtime.get('files'):raise ValueError('RUNTIME_BYTES_CHANGED')
    return {'schema':'skillsync.application-release/v1','version':package['version'],'architecture':runtime['architecture'],'sourceCommit':revision,'minimumSystemVersion':runtime['minimumSystemVersion'],'archive':archive.name,'sha256':digest(archive),'signing':'ad-hoc','notarized':False,'validation':'file hashes; verify published workflow provenance separately','bytes':total,'files':files}
def main():
    p=argparse.ArgumentParser();p.add_argument('--application',type=Path,required=True);p.add_argument('--archive',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    value=create(a.application,a.archive)
    with scoped(a.output).open('x') as stream:stream.write(json.dumps(value,sort_keys=True,indent=2)+'\n')
if __name__=='__main__':main()
