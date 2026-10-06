#!/usr/bin/env python3
"""Fail-closed source and publication inventory checks for the hosted workflow.

This script is part of an unexecuted proposal. It never installs dependencies,
changes source content during auditing, or resets a generated file.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

BUNDLE = Path(__file__).resolve().parent.parent
SOURCE = json.loads((BUNDLE / 'source-manifest.json').read_text())


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def command(root, *args, env=None):
    return subprocess.check_output(['git', '-C', str(root), *args], env=env)


def git_paths(root, *args):
    return [item.decode('utf-8') for item in command(root, *args, '-z').split(b'\0') if item]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def frozen_tree(root):
    # A fresh, private index avoids trusting the checkout's cached stat entries.
    fd, name = tempfile.mkstemp(prefix='arco-native-index-', dir=os.environ['RUNNER_TEMP'])
    os.close(fd)
    os.unlink(name)
    env = dict(os.environ, GIT_INDEX_FILE=name)
    try:
        command(root, 'read-tree', SOURCE['baseCommit'], env=env)
        command(root, 'add', '-u', '--', '.', env=env)
        return command(root, 'write-tree', env=env).decode().strip()
    finally:
        for path in (Path(name), Path(name + '.lock')):
            if path.exists():
                path.unlink()


def inventory(root, paths, prefix):
    """Hash regular files and link text; prohibit links out of each allowed root."""
    result = {}
    boundary = (root / prefix).resolve()
    for relative in sorted(path for path in paths if path.startswith(prefix)):
        path = root / relative
        if path.is_symlink():
            target = path.resolve(strict=True)
            if target != boundary and boundary not in target.parents:
                raise ValueError('Symlink escapes its allowed input root: ' + relative)
            value = {'type': 'symlink', 'target': os.readlink(path)}
        elif path.is_file():
            value = {'type': 'file', 'sha256': digest(path)}
        else:
            raise ValueError('Non-file input is not allowed: ' + relative)
        result[relative] = value
    encoded = json.dumps(result, sort_keys=True, separators=(',', ':')).encode()
    return {'sha256': hashlib.sha256(encoded).hexdigest(), 'count': len(result), 'files': result}


def publication():
    manifest = json.loads((BUNDLE / 'publication-manifest.json').read_text())
    actual = set(git_paths(BUNDLE, 'ls-files'))
    expected = set(manifest['publicationAllowlist'])
    if actual != expected:
        raise ValueError('Publication file list differs: ' + repr(sorted(actual ^ expected)))
    for relative, expected_hash in manifest['sha256'].items():
        path = BUNDLE / relative
        if path.is_symlink() or digest(path) != expected_hash:
            raise ValueError('Publication file hash differs: ' + relative)
    # Check ignored files too. Evidence and the isolated CLI dependencies are outputs.
    unexpected = [p for p in git_paths(BUNDLE, 'ls-files', '--others')
                  if not p.startswith(('evidence/', 'toolchain/node_modules/'))]
    if unexpected:
        raise ValueError('Unexpected publication inputs: ' + repr(unexpected))
    print('Publication allowlist and SHA-256 inventory match.')


def reconstruct_patch(root, patch):
    fd, name = tempfile.mkstemp(prefix='arco-native-patch-index-', dir=os.environ['RUNNER_TEMP'])
    os.close(fd)
    os.unlink(name)
    env = dict(os.environ, GIT_INDEX_FILE=name)
    try:
        command(root, 'read-tree', SOURCE['baseCommit'], env=env)
        command(root, 'apply', '--cached', '--check', str(patch), env=env)
        command(root, 'apply', '--cached', str(patch), env=env)
        return command(root, 'write-tree', env=env).decode().strip()
    finally:
        for path in (Path(name), Path(name + '.lock')):
            if path.exists():
                path.unlink()


def verify_candidate_ancestry(root):
    # The formatted candidate is an exact child of the previously reviewed fix.
    parent = SOURCE['candidateParent']
    if command(root, 'show', '-s', '--format=%P', 'HEAD').decode().strip().split() != [parent]:
        raise ValueError('Candidate does not have the exact frozen direct parent.')
    if command(root, 'show', '-s', '--format=%P', parent).decode().strip().split() != [SOURCE['baseCommit']]:
        raise ValueError('Candidate parent does not have the exact frozen base parent.')
    if command(root, 'rev-parse', parent + '^{tree}').decode().strip() != SOURCE['candidateParentTree']:
        raise ValueError('Candidate parent tree differs from the reviewed fix.')


def prepare(variant, root, evidence):
    specification = SOURCE['variants'][variant]
    head = command(root, 'rev-parse', 'HEAD').decode().strip()
    if head != specification['checkoutCommit']:
        raise ValueError('Checkout is not the exact frozen source commit.')
    if command(root, 'rev-parse', SOURCE['baseCommit'] + '^{tree}').decode().strip() != SOURCE['baseTree']:
        raise ValueError('Checkout base tree differs.')
    if command(root, 'status', '--porcelain') or git_paths(root, 'ls-files', '--others'):
        raise ValueError('Checkout is not empty of source changes and all untracked inputs.')
    patch = BUNDLE / specification['patch']
    reconstructed = reconstruct_patch(root, patch)
    if reconstructed != specification['tree']:
        raise ValueError('Base plus frozen patch does not reconstruct the expected variant tree.')
    if variant == 'candidate':
        verify_candidate_ancestry(root)
        if command(root, 'rev-parse', 'HEAD^{tree}').decode().strip() != reconstructed:
            raise ValueError('Published candidate commit differs from the reviewed patch tree.')
        # The exact commit already contains candidate.patch. Never apply it twice.
    else:
        command(root, 'apply', '--check', str(patch))
        command(root, 'apply', str(patch))
    write_json(evidence / 'reconstruction.json', {
        'variant': variant, 'checkoutCommit': head, 'baseCommit': SOURCE['baseCommit'],
        'patch': specification['patch'], 'reconstructedTree': reconstructed,
    })
    audit(variant, root, 'prepared', evidence)


def audit(variant, root, phase, evidence):
    specification = SOURCE['variants'][variant]
    report = {'variant': variant, 'phase': phase, 'errors': []}
    errors = report['errors']
    try:
        report['head'] = command(root, 'rev-parse', 'HEAD').decode().strip()
        if report['head'] != specification['checkoutCommit']:
            errors.append('HEAD changed from the exact frozen source commit.')
        report['trackedTree'] = frozen_tree(root)
        if report['trackedTree'] != specification['tree']:
            errors.append('Tracked tree differs from the exact frozen variant.')
        report['sourceSha256'] = {}
        for relative, expected_hash in SOURCE['candidateSourceSha256'].items():
            if relative == 'components/Slider/hooks/useLegalValue.ts':
                expected_hash = specification['hookSha256']
            path = root / relative
            current = digest(path)
            report['sourceSha256'][relative] = current
            if path.is_symlink() or current != expected_hash:
                errors.append('Frozen source file differs: ' + relative)
        paths = git_paths(root, 'ls-files', '--others')
        if phase in ('prepared', 'pre-install'):
            prefixes = ()
        elif phase in ('post-install', 'pre-icon'):
            prefixes = ('node_modules/',)
        else:
            prefixes = ('node_modules/', 'icon/react-icon/', 'icon/react-icon-cjs/')
        unexpected = [path for path in paths if not path.startswith(prefixes)]
        report['unexpectedUntracked'] = unexpected
        if unexpected:
            errors.append('Unexpected untracked or ignored source inputs exist.')
        for prefix, label in [('node_modules/', 'dependencies'),
                              ('icon/react-icon/', 'icons-es'),
                              ('icon/react-icon-cjs/', 'icons-cjs')]:
            current = inventory(root, paths, prefix)
            report[label] = {key: current[key] for key in ('sha256', 'count')}
            anchor_phase = 'post-install' if label == 'dependencies' else 'post-icon'
            anchor = evidence / (anchor_phase + '.' + label + '.files.json')
            if phase == anchor_phase:
                # Keep one complete anchor, not a duplicate full inventory for every phase.
                write_json(anchor, current)
            needs_anchor = (label == 'dependencies' and phase not in ('prepared', 'pre-install', 'post-install')) or (
                label != 'dependencies' and phase in ('pre-focused', 'post-focused', 'pre-full', 'post-full'))
            if needs_anchor:
                prior = json.loads(anchor.read_text())
                if current['sha256'] != prior['sha256']:
                    before, after = prior['files'], current['files']
                    delta = {p: {'before': before.get(p), 'after': after.get(p)}
                             for p in sorted(set(before) | set(after)) if before.get(p) != after.get(p)}
                    write_json(evidence / (phase + '.' + label + '.delta.json'), delta)
                    errors.append(label + ' changed after its installation/generation anchor.')
            required = (label == 'dependencies' and phase not in ('prepared', 'pre-install')) or (
                label != 'dependencies' and phase not in ('prepared', 'pre-install', 'post-install', 'pre-icon'))
            if required and current['count'] == 0:
                errors.append(label + ' is unexpectedly empty.')
    except Exception as error:
        errors.append(type(error).__name__ + ': ' + str(error))
    write_json(evidence / (phase + '.integrity.json'), report)
    if errors:
        # Preserve drift; do not conceal it with git checkout/reset or a broader allowlist.
        (evidence / (phase + '.tracked-diff.patch')).write_bytes(command(root, 'diff', 'HEAD', '--', '.'))
        raise ValueError('; '.join(errors))
    print(variant + ' ' + phase + ': frozen tracked source and allowed input inventories match.')


def main():
    if sys.argv[1:] == ['publication']:
        publication()
        return
    operation, variant, source_path, evidence_path, *tail = sys.argv[1:]
    root, evidence = Path(source_path).resolve(), Path(evidence_path).resolve()
    if variant not in SOURCE['variants']:
        raise ValueError('Unknown source variant.')
    if operation == 'prepare' and not tail:
        prepare(variant, root, evidence)
    elif operation == 'audit' and len(tail) == 1:
        audit(variant, root, tail[0], evidence)
    else:
        raise ValueError('Invalid integrity operation.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('INTEGRITY FAILURE: ' + str(error), file=sys.stderr)
        sys.exit(1)
