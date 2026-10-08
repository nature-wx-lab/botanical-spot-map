#!/usr/bin/env python3
"""Verify the public file and history boundary before creating a Pages artifact."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SITE_FILES = {
    'index.html', '404.html', '.nojekyll', 'styles.css', 'app.mjs', 'engine.mjs',
    'data/catalog.json', 'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/LICENSE',
    'vendor/images/layers.png', 'vendor/images/layers-2x.png',
    'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png',
    'vendor/images/marker-shadow.png',
    'data/nationwide.json', 'data/NOTICE.txt', 'data/CDLA-Permissive-2.0.txt',
    'data/Apache-2.0.txt', 'data/Foursquare-NOTICE.txt',
}
REPO_FILES = {'README.md', '.gitignore', '.github/workflows/pages.yml',
              'scripts/check_release.py', 'scripts/vendor_hashes.json',
              'tests/search.test.mjs', 'scripts/import_places.py'} | {'site/' + p for p in SITE_FILES}
IDENTITIES = {
    ('nature-wx-lab', '289840956+nature-wx-lab@users.noreply.github.com'),
    ('github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com'),
}
ALLOWED_EMAILS = {email for _, email in IDENTITIES}
EMAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
PATTERNS = [
    '/'+ 'Users/', '/'+ 'home/', 'file'+ '://', 'Life'+ 'Plan',
    'Documents/'+ 'Codex', 'private/'+ 'var/folders',
    r'gh' + r'[opusr]_[A-Za-z0-9]{20,}', 'github' + r'_pat_[A-Za-z0-9_]+',
    r'AKIA[A-Z0-9]{16}', r'sk' + r'-[A-Za-z0-9_-]{20,}',
    'BEGIN ' + r'(?:RSA |EC |OPENSSH )?PRIVATE KEY',
]
if os.environ.get('USER') not in {None, '', 'runner', 'root'}:
    PATTERNS.append(re.escape(os.environ['USER']))
PRIVATE_RE = re.compile('|'.join(PATTERNS), re.I)
IMAGE_FILES = {name for name in SITE_FILES if name.endswith('.png')}

def fail(label):
    raise SystemExit('PUBLIC_RELEASE_BLOCKED: ' + label)

def scan(raw, label):
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        fail(label + ': unexpected binary data')
    if PRIVATE_RE.search(text):
        fail(label + ': private path or credential pattern')
    if any(email not in ALLOWED_EMAILS for email in EMAIL_RE.findall(text)):
        fail(label + ': non-allowlisted email')

def git(*args):
    return subprocess.check_output(['git', '-c', 'gc.auto=0', *args], cwd=ROOT)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    paths = {p.relative_to(ROOT / 'site').as_posix() for p in (ROOT / 'site').rglob('*') if p.is_file()}
    if paths != SITE_FILES:
        fail('site allowlist mismatch')
    hashes = json.loads((ROOT / 'scripts/vendor_hashes.json').read_text())
    if set(hashes) != {p for p in SITE_FILES if p.startswith('vendor/')}:
        fail('vendor allowlist mismatch')
    for path in sorted(REPO_FILES):
        p = ROOT / path
        limit = 6000000 if path == 'site/data/nationwide.json' else 600000
        if not p.is_file() or p.is_symlink() or p.stat().st_size > limit:
            fail('missing, symbolic or oversized file: ' + path)
        scan(path.encode(), 'filename')
        raw = p.read_bytes()
        if path.removeprefix('site/') not in IMAGE_FILES:
            scan(raw, path)
    for path, expected in hashes.items():
        if hashlib.sha256((ROOT / 'site' / path).read_bytes()).hexdigest() != expected:
            fail('vendor bytes mismatch: ' + path)
    subprocess.run(['node', '--input-type=module', '-e',
        "import {readFileSync} from 'node:fs'; import {mergeCatalog} from './site/engine.mjs'; const data = mergeCatalog(JSON.parse(readFileSync('site/data/catalog.json')), JSON.parse(readFileSync('site/data/nationwide.json'))); if (data.facilities.length !== 10000 || new Set(data.facilities.map(f=>f.prefecture)).size !== 47) throw Error('National coverage mismatch');"], cwd=ROOT, check=True)
    bulk = json.loads((ROOT / 'site/data/nationwide.json').read_text())
    fields = {'id', 'name', 'prefecture', 'city', 'category', 'lat', 'lon', 'url', 'confidence', 'source'}
    if any(set(record) != fields for record in bulk['records']):
        fail('nationwide record field allowlist mismatch')
    if set(bulk) != {'schema_version', 'release', 'retrieved_at', 'count', 'minimum_confidence', 'geography_source', 'providers', 'records', 'selection'}:
        fail('nationwide metadata field allowlist mismatch')
    # A clean new repository means this bounded history check starts with one commit.
    commits = git('rev-list', '--all').decode().splitlines()
    tracked = set(git('ls-files', '-z').decode().split('\0')) - {''}
    if tracked != REPO_FILES:
        fail('tracked file allowlist mismatch')
    for commit in commits:
        names = set(git('ls-tree', '-r', '--name-only', commit).decode().splitlines())
        if not names <= REPO_FILES:
            fail(commit[:12] + ': history file allowlist mismatch')
        fields = git('show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', commit).decode().split('\0', 4)
        if (fields[0], fields[1]) not in IDENTITIES or (fields[2], fields[3]) not in IDENTITIES:
            fail(commit[:12] + ': author or committer mismatch')
        scan(fields[4].encode(), commit[:12] + ': commit message')
        for path in sorted(names):
            scan(path.encode(), commit[:12] + ': filename')
            raw = git('show', commit + ':' + path)
            if path.removeprefix('site/') not in IMAGE_FILES:
                scan(raw, commit[:12] + ':' + path)
            elif hashlib.sha256(raw).hexdigest() != hashes[path.removeprefix('site/')]:
                fail(commit[:12] + ': unexpected binary asset')
    if args.stage:
        stage = ROOT / '.build/site'
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(parents=True)
        for path in sorted(SITE_FILES):
            dest = stage / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / 'site' / path, dest)
    print(f'PUBLIC_RELEASE_OK site_files={len(SITE_FILES)} history_commits={len(commits)}')

if __name__ == '__main__':
    main()
