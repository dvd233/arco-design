#!/usr/bin/env python3
"""Static draft. Native-auditor inventory design, with phase-specific anchors.

No install/build is performed. Full dependency/icon/CSS inventories use the same
sorted compact JSON hashing as the observed native hosted integrity artifacts.
"""
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

BUNDLE = Path(__file__).resolve().parent.parent
PHASES = ['prepared', 'pre-install', 'post-install', 'pre-icon', 'post-icon',
          'pre-css', 'post-css', 'pre-harness', 'post-harness', 'pre-browser', 'post-browser']


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def write_json(path, value, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x' if exclusive else 'w') as handle:
        handle.write(json.dumps(value, indent=2, sort_keys=True) + '\n')


def inventory(root, paths, prefix=None, exact=None):
    result = {}
    selected = sorted(p for p in paths if p.startswith(prefix)) if prefix else sorted(p for p in paths if p in exact)
    boundary = (root / prefix).resolve() if prefix else None
    for relative in selected:
        path = root / relative
        if path.is_symlink():
            target = path.resolve(strict=True)
            if boundary is None or (target != boundary and boundary not in target.parents):
                raise ValueError('Symlink escapes its allowed input root: ' + relative)
            result[relative] = {'type': 'symlink', 'target': os.readlink(path)}
        elif path.is_file():
            result[relative] = {'type': 'file', 'sha256': digest(path)}
        else:
            raise ValueError('Non-file input: ' + relative)
    encoded = json.dumps(result, sort_keys=True, separators=(',', ':')).encode()
    return {'sha256': hashlib.sha256(encoded).hexdigest(), 'count': len(result), 'files': result}


def main():
    source_path, variant, phase, evidence_path = sys.argv[1:]
    if variant not in ('baseline', 'fixed') or phase not in PHASES:
        raise ValueError('Unknown variant/phase')
    root, evidence = Path(source_path).resolve(), Path(evidence_path).resolve()
    manifest = json.loads((BUNDLE / 'source-manifest.json').read_text())
    if manifest['state'] != 'frozen-audited':
        raise ValueError('Draft manifest is not executable')
    source = json.loads((evidence / (phase + '.source.json')).read_text())
    expected = manifest['baseline' if variant == 'baseline' else 'candidate']
    if source['commit'] != expected['sha'] or source['tree'] != expected['tree']:
        raise ValueError('Phase source identity differs')
    if source['sourceLockSha256'] != manifest['sourceLockSha256'] or digest(root / 'yarn.lock') != manifest['sourceLockSha256']:
        raise ValueError('Source lock changed')
    scope = {'runId': os.environ.get('GITHUB_RUN_ID'), 'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
             'validationCommit': os.environ.get('GITHUB_SHA'),
             'manifestSha256': digest(BUNDLE / 'source-manifest.json'),
             'publicationSha256': digest(BUNDLE / 'publication-manifest.json')}
    if not all(scope.values()):
        raise ValueError('Fresh hosted run identity is required')
    context = {'variant': variant, 'commit': source['commit'], 'tree': source['tree'],
               'sourceLockSha256': source['sourceLockSha256'], 'scope': scope}
    phase_context_path = evidence / (phase + '.context.json')
    phase_context = json.loads(phase_context_path.read_text())
    if phase_context['schemaVersion'] != 2 or phase_context['scope'] != scope or phase_context['phase'] != phase or phase_context['variant'] != variant:
        raise ValueError('Phase context is not from this exact current execution')
    def time_value(text):
        value = datetime.fromisoformat(text.replace('Z', '+00:00'))
        age = (datetime.now(timezone.utc) - value).total_seconds()
        if age < -30 or age > manifest['runtime']['maxEvidenceAgeSeconds']:
            raise ValueError('Stale or future evidence timestamp')
        return value
    def read_reference(reference, filename):
        if reference != {'path': filename, 'sha256': digest(evidence / filename)}:
            raise ValueError('Predecessor/producer evidence bytes changed: ' + filename)
        return json.loads((evidence / filename).read_text())
    position = PHASES.index(phase)
    before = None
    if position:
        previous = PHASES[position - 1]
        before = read_reference(phase_context['predecessor'], previous + '.phase.json')
        if before['schemaVersion'] != 2 or before['success'] is not True or before['phase'] != previous or before['variant'] != variant or before['scope'] != scope:
            raise ValueError('Successful exact predecessor phase is required')
        if time_value(before['finishedAt']) > time_value(phase_context['startedAt']):
            raise ValueError('Phase precedes its predecessor')
    elif phase_context['predecessor'] is not None:
        raise ValueError('Prepared phase cannot have a predecessor')
    producing_stage = {'post-install': 'install', 'post-icon': 'icon', 'post-css': 'css', 'post-harness': 'build', 'post-browser': 'browser'}.get(phase)
    if producing_stage:
        producer = read_reference(phase_context['producer'], producing_stage + '.command.json')
        if producer['schemaVersion'] != 2 or producer['stage'] != producing_stage or producer['variant'] != variant or producer['scope'] != scope or producer['predecessor'] != phase_context['predecessor']:
            raise ValueError('Producer is stale, skipped, or unrelated to the exact successful predecessor')
        if not time_value(before['finishedAt']) <= time_value(producer['startedAt']) <= time_value(producer['finishedAt']) <= time_value(phase_context['startedAt']):
            raise ValueError('Producer timestamps do not link the pre/post phases')
        expected_exit = 1 if producing_stage == 'browser' and variant == 'baseline' else 0
        if producer['exitCode'] != expected_exit or (evidence / (producing_stage + '.exit-code')).read_text() != str(expected_exit) + '\n':
            raise ValueError('Actual producer process exit failed')
        if digest(evidence / (producing_stage + '.log')) != producer['logSha256']:
            raise ValueError('Producer log changed')
    elif phase_context['producer'] is not None:
        raise ValueError('Non-producing phase cannot invent a producer')
    raw = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--others', '-z'])
    paths = [item.decode() for item in raw.split(b'\0') if item]
    position = PHASES.index(phase)
    prefixes = []
    if position >= PHASES.index('post-install'):
        prefixes.append('node_modules/')
    if position >= PHASES.index('post-icon'):
        prefixes += ['icon/react-icon/', 'icon/react-icon-cjs/']
    css_files = []
    if position >= PHASES.index('post-css'):
        if manifest['css']['state'] != 'audited-native-css':
            raise ValueError('Native CSS source audit is unresolved')
        css_files = manifest['css']['outputFiles']
    unexpected = [p for p in paths if not p.startswith(tuple(prefixes)) and p not in css_files]
    report = {'context': context, 'phase': phase, 'chain': {'contextSha256': digest(phase_context_path), 'predecessor': phase_context['predecessor'], 'producer': phase_context['producer']}, 'errors': [], 'unexpectedUntracked': unexpected}
    if unexpected:
        report['errors'].append('Unexpected untracked or ignored inputs')
    groups = [('dependencies', 'node_modules/', 'post-install', 'install'),
              ('icons-es', 'icon/react-icon/', 'post-icon', 'icon'),
              ('icons-cjs', 'icon/react-icon-cjs/', 'post-icon', 'icon'),
              ('css', None, 'post-css', 'css')]
    for label, prefix, anchor_phase, command_name in groups:
        current = inventory(root, paths, prefix=prefix, exact=css_files)
        report[label] = {key: current[key] for key in ('sha256', 'count')}
        anchor_position = PHASES.index(anchor_phase)
        if position < anchor_position:
            if current['count']:
                report['errors'].append(label + ' exists before its producing stage')
            continue
        if not current['count']:
            report['errors'].append(label + ' is empty after its producing stage')
        if label == 'css' and set(current['files']) != set(css_files):
            report['errors'].append('Native CSS outputs differ from the exact audited file list')
        if label == 'css':
            audit_path = BUNDLE / 'css-source-audit.json'
            if digest(audit_path) != manifest['css']['auditRecordSha256']:
                report['errors'].append('CSS source audit changed')
            css_audit = json.loads(audit_path.read_text())
            if css_audit['outputFiles'] != css_files:
                report['errors'].append('CSS audit output file list differs')
            permitted_empty = css_audit.get('permittedEmptyOutputs', {})
            for output in css_files:
                if (root / output).stat().st_size == 0:
                    if output not in permitted_empty or digest(root / output) != permitted_empty[output]['sha256']:
                        report['errors'].append('Unexpected empty native CSS output: ' + output)
            main_css = (root / manifest['css']['mainOutput']).read_bytes()
            if not main_css or not all(marker in main_css for marker in (b'.arco-slider-button', b'.arco-input', b'.arco-tooltip')):
                report['errors'].append('Full native CSS is empty or missing expected component styles')
            for output, specification in css_audit['expectedCopies'].items():
                if current['files'].get(output) != {'type': 'file', 'sha256': specification['sha256']}:
                    report['errors'].append('Generated Less/plugin copy differs from committed source: ' + output)
                if digest(root / specification['source']) != specification['sha256']:
                    report['errors'].append('Copied source input changed: ' + specification['source'])
        command_path = evidence / (command_name + '.command.json')
        command = json.loads(command_path.read_text())
        expected_argv = ['<native-node>', '<pinned-yarn>'] + manifest['preparation'][command_name + 'Args']
        if command_name == 'install':
            expected_argv += ['--cache-folder', '<isolated-cache>']
        if command['command'] != expected_argv or command['sourceLockSha256'] != manifest['sourceLockSha256']:
            report['errors'].append('Producing command or lock differs: ' + command_name)
        if command['scope'] != scope or command['stage'] != command_name or command['variant'] != variant:
            report['errors'].append('Producing command is not from this current run/attempt/validation commit')
        command_before = {'install': 'pre-install', 'icon': 'pre-icon', 'css': 'pre-css'}[command_name]
        command_predecessor = read_reference(command['predecessor'], command_before + '.phase.json')
        if command_predecessor['success'] is not True or command_predecessor['scope'] != scope or command_predecessor['phase'] != command_before:
            report['errors'].append('Producing command lacks its successful exact predecessor')
        if not time_value(command_predecessor['finishedAt']) <= time_value(command['startedAt']) <= time_value(command['finishedAt']):
            report['errors'].append('Producing command has stale/unordered timestamps')
        if command['tools']['nativeNodeVersion'] != manifest['preparation']['nativeNodeVersion'] or command['tools']['yarnVersion'] != manifest['preparation']['yarnVersion']:
            report['errors'].append('Producing tool versions differ: ' + command_name)
        if command['tools']['harnessLockSha256'] != manifest['harnessLockSha256']:
            report['errors'].append('Producing tool lock differs: ' + command_name)
        if command['tools']['toolchainLockSha256'] != manifest['toolchainLockSha256']:
            report['errors'].append('Producing Yarn lock differs: ' + command_name)
        if command.get('diagnosticErrors'):
            report['errors'].append('Producing command logged native compiler errors: ' + command_name)
        if command_name == 'css':
            if digest(evidence / 'css-package-resolution.json') != command['packageResolutionSha256']:
                report['errors'].append('CSS dependency resolution metadata changed')
            for key, value in manifest['css']['environment'].items():
                if command['environment'].get(key) != value:
                    report['errors'].append('CSS command environment differs: ' + key)
        if command['exitCode'] != 0 or command['sourceCommit'] != source['commit'] or command['sourceTree'] != source['tree']:
            report['errors'].append('Producing command failed or has the wrong source identity: ' + command_name)
        if digest(evidence / (command_name + '.log')) != command['logSha256']:
            report['errors'].append('Producing command log changed: ' + command_name)
        binding = dict(context, commandRecordSha256=digest(command_path), predecessor=command['predecessor'])
        anchor_path = evidence / (anchor_phase + '.' + label + '.files.json')
        if phase == anchor_phase and not report['errors']:
            write_json(anchor_path, dict(current, context=binding), exclusive=True)
        elif position > anchor_position:
            prior = json.loads(anchor_path.read_text())
            if prior['context'] != binding:
                report['errors'].append('Anchor source/run/command binding changed: ' + label)
            if current['sha256'] != prior['sha256']:
                before, after = prior['files'], current['files']
                delta = {p: {'before': before.get(p), 'after': after.get(p)}
                         for p in sorted(set(before) | set(after)) if before.get(p) != after.get(p)}
                write_json(evidence / (phase + '.' + label + '.delta.json'), delta)
                report['errors'].append(label + ' changed after its installation/generation anchor')
    write_json(evidence / (phase + '.integrity.json'), report, exclusive=True)
    if report['errors']:
        raise ValueError('; '.join(report['errors']))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('INVENTORY FAILURE: ' + str(error), file=sys.stderr)
        sys.exit(1)
