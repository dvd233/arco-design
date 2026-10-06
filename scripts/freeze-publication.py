#!/usr/bin/env python3
"""Static publication assembly only. Never installs, builds, launches or publishes."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXED_FILES = [
    '.gitignore', '.github/workflows/validate-slider-negative-marks-browser.yml',
    'LICENSE', 'README.md', 'CSS_SOURCE_GATE.md', 'LOCK_PROVENANCE.json',
    'actions-lock.json', 'css-source-audit.json', 'candidate.patch',
    'package.json', 'package-lock.json', 'source-manifest.json',
    'toolchain/package.json', 'toolchain/package-lock.json',
    'harness/index.html', 'harness/main.jsx', 'harness/style.css',
    'scripts/source.mjs', 'scripts/evidence.mjs', 'scripts/verify-evidence.mjs',
    'scripts/phase.mjs', 'scripts/input-inventory.py', 'scripts/prepare.mjs',
    'scripts/build.mjs', 'scripts/browser.mjs', 'scripts/run-stage.mjs',
    'scripts/spec.mjs', 'scripts/classify.mjs', 'scripts/verify-pair.mjs',
    'scripts/freeze-publication.py',
    'tests/classifier.test.mjs', 'tests/source-binding.test.mjs',
    'tests/evidence-fixture.mjs', 'tests/evidence-contract.test.mjs',
]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_object(kind, data):
    return hashlib.sha1((kind + ' ' + str(len(data)) + '\0').encode() + data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def tree_hash(files):
    tree = {}
    for file, data in files.items():
        parts = file.split('/')
        branch = tree
        for part in parts[:-1]:
            branch = branch.setdefault(part, {})
        branch[parts[-1]] = git_object('blob', data)
    def emit(branch):
        entries = []
        for name, value in sorted(branch.items(), key=lambda item: (item[0] + ('/' if isinstance(item[1], dict) else '')).encode()):
            directory = isinstance(value, dict)
            digest = emit(value) if directory else value
            entries.append(('40000' if directory else '100644').encode() + b' ' + name.encode() + b'\0' + bytes.fromhex(digest))
        return git_object('tree', b''.join(entries))
    return emit(tree)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-candidate', required=True)
    parser.add_argument('--allowlist-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'source-manifest.json').read_text())
    if manifest['candidate']['sha'] != args.expected_candidate:
        raise ValueError('Candidate identity changed; do not freeze stale source.')
    files = {name: (ROOT / name).read_bytes() for name in FIXED_FILES}
    for name in files:
        if (ROOT / name).is_symlink():
            raise ValueError('Publication inputs must be ordinary files: ' + name)
    inventory = {name: {'sha256': sha256(data), 'bytes': len(data)} for name, data in sorted(files.items())}
    write_json(ROOT / 'PUBLICATION_ALLOWLIST.json', {
        'schemaVersion': 1, 'status': 'REVIEW_ONLY_ALLOWLIST',
        'candidate': args.expected_candidate,
        'publicationFiles': sorted(FIXED_FILES + ['publication-manifest.json']),
        'currentFileInventory': inventory,
        'reviewOnlyExcluded': ['runtime-freeze-draft.json', 'PUBLICATION_ALLOWLIST.json', 'evidence/', 'work/', 'node_modules/', 'toolchain/node_modules/'],
    })
    if args.allowlist_only:
        print('Static allowlist prepared; no runnable publication manifest/tree was frozen.')
        return
    if manifest['state'] != 'frozen-audited' or manifest['css']['state'] != 'audited-native-css' or not isinstance(manifest['runtime'], dict):
        raise ValueError('Explicit publisher-approved state/runtime/CSS contract is required.')
    if sha256(files['candidate.patch']) != manifest['candidatePatchSha256']:
        raise ValueError('Approved original candidate patch bytes differ.')
    for file, digest in [('package-lock.json', manifest['harnessLockSha256']), ('toolchain/package-lock.json', manifest['toolchainLockSha256']), ('css-source-audit.json', manifest['css']['auditRecordSha256'])]:
        if sha256(files[file]) != digest:
            raise ValueError('Frozen input digest differs: ' + file)
    write_json(ROOT / 'publication-manifest.json', {'schemaVersion': 1, 'files': inventory})
    files['publication-manifest.json'] = (ROOT / 'publication-manifest.json').read_bytes()
    out = ROOT / 'evidence' / 'publication-freeze'
    payload = {'tree': [{'path': name, 'mode': '100644', 'type': 'blob', 'content': data.decode('utf-8')} for name, data in sorted(files.items())]}
    write_json(out / 'git-tree-payload.json', payload)
    summary = {
        'status': 'LOCAL_EXECUTABLE_CANDIDATE_ONLY_NOT_PUBLISHED_OR_RUN',
        'repository': manifest['execution']['repository'], 'targetRef': manifest['execution']['ref'],
        'candidate': manifest['candidate'], 'expectedPublicationTree': tree_hash(files),
        'fileCount': len(files), 'totalBytes': sum(map(len, files.values())),
        'files': {name: {'sha256': sha256(data), 'gitBlob': git_object('blob', data), 'bytes': len(data)} for name, data in sorted(files.items())},
        'gitTreePayloadSha256': sha256((out / 'git-tree-payload.json').read_bytes()),
        'publicationManifestSha256': sha256(files['publication-manifest.json']),
        'publicationPerformed': False, 'producerExecutionPerformed': False,
        'nextStep': 'Publisher and independent reviewer verify exact tree/file bytes, then publisher alone selects a verified non-forced commit parent and creates/updates the exact validation ref. The hosted job must prove real preparation/build/browser results.',
    }
    write_json(out / 'FREEZE.json', summary)
    print(json.dumps({key: summary[key] for key in ['status', 'candidate', 'expectedPublicationTree', 'fileCount', 'totalBytes', 'gitTreePayloadSha256']}))


if __name__ == '__main__':
    main()
