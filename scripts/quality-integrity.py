#!/usr/bin/env python3
"""Metadata-only, fail-closed quality-stage guards. No dependency/application code is loaded."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
BUNDLE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('native_integrity', BUNDLE / 'scripts/integrity.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
SOURCE = native.SOURCE
CSS = json.loads((BUNDLE / 'quality-css-contract.json').read_text())
ROOTS = ('node_modules/', 'site/node_modules/', 'icon/react-icon/', 'icon/react-icon-cjs/',
         'lib/', 'hooks/lib/', 'es/', 'hooks/es/', 'dist/css/', 'dist/asset/', '.coverage/')
WRITERS = {'root-install': ('node_modules/',), 'site-install': ('site/node_modules/',),
           'icon': ('icon/react-icon/', 'icon/react-icon-cjs/'),
           'build-cjs': ('lib/', 'hooks/lib/'), 'build-es': ('es/', 'hooks/es/'),
           'build-css': ('es/', 'lib/', 'dist/css/', 'dist/asset/'),
           'slider-client': ('.coverage/',), 'full-client': ('.coverage/',)}
STAGES = ['root-install', 'site-install', 'runtime', 'client-show-config', 'node-show-config',
          'client-list', 'node-list', 'types-show-config', 'changed-eslint', 'changed-prettier',
          'icon', 'source-types', 'build-cjs', 'build-es', 'build-css', 'slider-client',
          'full-client', 'full-node']
write = native.write_json
digest = native.digest

def source_spec(variant):
    if variant == 'candidate':
        return SOURCE['candidateCommit'], SOURCE['variants']['candidate']['tree']
    if variant == 'baseline':
        return SOURCE['baseCommit'], SOURCE['baseTree']
    raise ValueError('Unknown variant')

def inventory(root, paths):
    # Each root is its own symlink boundary; reject root symlinks before traversing.
    for prefix in ROOTS:
        p = root / prefix
        if p.is_symlink():
            raise ValueError('Output root is a symlink: ' + prefix)
    result = {}
    for relative in sorted(paths):
        p = root / relative
        boundary = root
        for prefix in ROOTS:
            if relative.startswith(prefix):
                boundary = (root / prefix).resolve()
                break
        if p.is_symlink():
            resolved = p.resolve(strict=True)
            if resolved != boundary and boundary not in resolved.parents:
                raise ValueError('Symlink escapes input/output boundary: ' + relative)
            result[relative] = {'type': 'symlink', 'target': os.readlink(p)}
        elif p.is_file():
            result[relative] = {'type': 'file', 'sha256': digest(p), 'size': p.stat().st_size,
                                'executable': bool(p.stat().st_mode & 0o111)}
        else:
            raise ValueError('Missing or special file: ' + relative)
    encoded = json.dumps(result, sort_keys=True, separators=(',', ':')).encode()
    return {'sha256': hashlib.sha256(encoded).hexdigest(), 'count': len(result), 'files': result}

def delta(before, after):
    return {p: {'before': before.get(p), 'after': after.get(p)}
            for p in sorted(set(before) | set(after)) if before.get(p) != after.get(p)}

def prepare(variant, root, evidence):
    commit, tree = source_spec(variant)
    if native.command(root, 'rev-parse', 'HEAD').decode().strip() != commit:
        raise ValueError('Wrong exact checkout commit')
    if native.command(root, 'rev-parse', 'HEAD^{tree}').decode().strip() != tree:
        raise ValueError('Wrong exact checkout tree')
    if native.command(root, 'status', '--porcelain') or native.git_paths(root, 'ls-files', '--others'):
        raise ValueError('Fresh checkout contains tracked changes or untracked/ignored inputs')
    if variant == 'candidate':
        parents = native.command(root, 'show', '-s', '--format=%P', 'HEAD').decode().strip().split()
        if parents != [SOURCE['baseCommit']]:
            raise ValueError('Candidate sole parent differs')
        if native.reconstruct_patch(root, BUNDLE / 'patches/candidate.patch') != tree:
            raise ValueError('Candidate patch/tree differs')
    write(evidence / 'source.json', {'variant': variant, 'commit': commit, 'tree': tree,
                                    'pristine': variant == 'baseline', 'patchApplied': False})
    write(evidence / 'state.json', {'anchors': {}})
    tracked = inventory(root, native.git_paths(root, 'ls-files'))
    write(evidence / 'prepared.source.files.json', tracked)
    audit(variant, root, evidence, 'prepared', 'pre')

def audit(variant, root, evidence, stage, boundary):
    commit, tree = source_spec(variant)
    state = json.loads((evidence / 'state.json').read_text())
    anchors = state['anchors']
    allowed_writes = WRITERS.get(stage, ()) if boundary == 'post' else ()
    report = {'variant': variant, 'stage': stage, 'boundary': boundary, 'errors': [], 'inventories': {}}
    errors = report['errors']
    try:
        report['commit'] = native.command(root, 'rev-parse', 'HEAD').decode().strip()
        report['trackedTree'] = native.frozen_tree(root)
        if report['commit'] != commit or report['trackedTree'] != tree:
            errors.append('Exact source commit/tree changed')
        tracked = inventory(root, native.git_paths(root, 'ls-files'))
        original = json.loads((evidence / 'prepared.source.files.json').read_text())
        report['source'] = {k: tracked[k] for k in ('sha256', 'count')}
        if tracked['sha256'] != original['sha256']:
            write(evidence / f'{stage}.{boundary}.source.delta.json', delta(original['files'], tracked['files']))
            errors.append('Tracked source bytes/modes changed')
        paths = native.git_paths(root, 'ls-files', '--others')
        prefixes = tuple(set(anchors) | set(allowed_writes))
        unexpected = [p for p in paths if not p.startswith(prefixes)]
        report['unexpected'] = unexpected
        if unexpected:
            errors.append('Unexpected ignored/untracked paths')
        updates = {}
        for prefix in ROOTS:
            current = inventory(root, [p for p in paths if p.startswith(prefix)])
            report['inventories'][prefix] = {k: current[k] for k in ('sha256', 'count')}
            prior = json.loads((evidence / anchors[prefix]).read_text()) if prefix in anchors else {'files': {}}
            changes = delta(prior['files'], current['files'])
            if changes and prefix not in allowed_writes:
                errors.append('Immutable input/output changed: ' + prefix)
            if stage == 'build-css' and boundary == 'post' and prefix in allowed_writes:
                forbidden = sorted(set(changes) - set(CSS['outputFiles']))
                deleted = [p for p, change in changes.items() if change['after'] is None]
                if forbidden or deleted:
                    errors.append('CSS touched paths outside exact output contract: ' + repr(forbidden + deleted))
            if changes:
                write(evidence / f'{stage}.{boundary}.{prefix.replace("/", "_")}.delta.json', changes)
            if prefix in allowed_writes:
                anchor = f'{stage}.{prefix.replace("/", "_")}.files.json'
                write(evidence / anchor, current)
                updates[prefix] = anchor
        # Never adopt a corrupt inventory as a future trusted anchor.
        if not errors and boundary == 'post':
            anchors.update(updates)
            write(evidence / 'state.json', state)
    except Exception as error:
        errors.append(type(error).__name__ + ': ' + str(error))
    write(evidence / f'{stage}.{boundary}.integrity.json', report)
    if errors:
        (evidence / f'{stage}.{boundary}.tracked-diff.patch').write_bytes(native.command(root, 'diff', 'HEAD', '--', '.'))
        raise ValueError('; '.join(errors))
    print(f'{variant} {stage} {boundary}: source and phase-bound inventories match')

def parse_embedded_json(text, kind):
    # Original Yarn/Arco logs surround one JSON payload. Do not accept ambiguous candidates.
    decoder = json.JSONDecoder()
    found = []
    for match in re.finditer(r'^[\[{]', text, re.M):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except json.JSONDecodeError:
            continue
        if (kind == 'config' and isinstance(value, dict) and 'configs' in value and 'globalConfig' in value
                or kind == 'list' and isinstance(value, list) and all(isinstance(x, str) for x in value)
                or kind == 'types' and isinstance(value, dict) and 'compilerOptions' in value):
            found.append(value)
    if len(found) != 1:
        raise ValueError(f'Expected one unambiguous {kind} JSON payload, found {len(found)}')
    return found[0]

def validate(root, evidence, stage):
    log = (evidence / f'{stage}.log').read_text(errors='replace')
    if stage in ('client-show-config', 'node-show-config'):
        parsed = parse_embedded_json(log, 'config')
        if len(parsed['configs']) != 1:
            raise ValueError('Unexpected Jest projects/config count')
        config, global_config = parsed['configs'][0], parsed['globalConfig']
        client = stage.startswith('client')
        if Path(config['rootDir']).resolve() != root:
            raise ValueError('Effective Jest source root differs')
        if config.get('name') != hashlib.md5((str(root) + '0').encode()).hexdigest():
            raise ValueError('Unexpected generated Jest project identity')
        if global_config.get('collectCoverage') is not client:
            raise ValueError('Native default coverage meaning differs')
        if client and Path(global_config['coverageDirectory']).resolve() != root / '.coverage':
            raise ValueError('Unexpected native client coverage output')
        if not config['testEnvironment'].endswith(('jest-environment-jsdom/build/index.js' if client else 'jest-environment-node/build/index.js')):
            raise ValueError('Native test environment differs')
        expected_regex = '.*\\.test\\.(j|t)sx?$' if client else 'demo\\.test\\.(j|t)sx?$'
        if config['testRegex'] != [expected_regex]:
            raise ValueError('Native selected test regex differs')
        write(evidence / f'{stage}.parsed.json', parsed)
    elif stage in ('client-list', 'node-list'):
        parsed = parse_embedded_json(log, 'list')
        if not parsed or len(parsed) != len(set(parsed)):
            raise ValueError('Empty/duplicate native selected tests')
        for p in parsed:
            resolved = Path(p).resolve(strict=True)
            if root not in resolved.parents or not resolved.is_file():
                raise ValueError('Selected test is outside exact source')
            if stage == 'node-list' and not re.search(r'demo\.test\.(j|t)sx?$', p):
                raise ValueError('Node selection is not the native demo/SSR suite')
        write(evidence / f'{stage}.parsed.json', parsed)
    elif stage == 'types-show-config':
        write(evidence / f'{stage}.parsed.json', parse_embedded_json(log, 'types'))
    elif stage == 'changed-eslint':
        parsed = json.loads((evidence / 'changed-eslint.json').read_text())
        if sorted(Path(x['filePath']).relative_to(root).as_posix() for x in parsed) != sorted(SOURCE['candidateSourceSha256'].keys() & {'components/Slider/hooks/useLegalValue.ts', 'components/Slider/__test__/index.test.tsx'}):
            raise ValueError('ESLint did not inspect exactly the changed files')
        if any(x['errorCount'] or x.get('fatalErrorCount', 0) for x in parsed):
            raise ValueError('ESLint reported errors')
    elif stage == 'icon':
        for prefix in WRITERS['icon']:
            if not (root / prefix).is_dir() or not any((root / prefix).iterdir()):
                raise ValueError('Missing generated icons: ' + prefix)
    elif stage in ('build-cjs', 'build-es', 'build-css'):
        if re.search(r'error TS\d+|Failed to (?:compile|build|append|inject|update style)|Error:|error Command failed', log, re.I):
            raise ValueError('Compiler failure diagnostic, irrespective of process exit')
        if stage == 'build-css':
            outputs = CSS['outputFiles']
            for p, expected in CSS['expectedCopies'].items():
                if digest(root / p) != expected['sha256']:
                    raise ValueError('CSS raw/plugin copy differs: ' + p)
        else:
            prefix = 'lib' if stage == 'build-cjs' else 'es'
            outputs = [f'{prefix}/index.js', f'{prefix}/Slider/index.js', f'{prefix}/Slider/hooks/useLegalValue.js', f'hooks/{prefix}/index.js']
            if stage == 'build-es':
                outputs.append('es/index.d.ts')
        hashes = {}
        for relative in outputs:
            p = root / relative
            empty = CSS.get('permittedEmptyOutputs', {}).get(relative) if stage == 'build-css' else None
            if p.is_symlink() or not p.is_file() or (p.stat().st_size == 0 and not empty):
                raise ValueError('Missing/empty/symlink native output: ' + relative)
            if empty and digest(p) != empty['sha256']:
                raise ValueError('Exact source-derived empty CSS entry differs: ' + relative)
            hashes[relative] = digest(p)
        write(evidence / f'{stage}.required-output-hashes.json', hashes)
    print(stage + ': metadata/output validation completed')

def record_command(evidence, stage, root, timeout, argv):
    # Whitelist metadata; never dump the runner environment or credentials.
    keys = ['CI', 'TZ', 'NODE_ENV', 'NODE_OPTIONS', 'HUSKY', 'FORCE_COLOR',
            'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', 'PUPPETEER_SKIP_DOWNLOAD',
            'GIT_TERMINAL_PROMPT', 'npm_config_offline', 'npm_config_cache',
            'XDG_CACHE_HOME', 'TMPDIR', 'PATH']
    if any(k.startswith('BUILD_ENV_') for k in os.environ) or os.environ.get('NODE_ENV'):
        raise ValueError('Build environment override is present')
    write(evidence / f'{stage}.command.json', {'argv': argv, 'cwd': str(root),
          'timeoutSeconds': int(timeout), 'environment': {k: os.environ.get(k) for k in keys}})

def write_status(evidence, stage, variant, process, logger, pre, post, validation, completed):
    codes = dict(zip(['processExit', 'loggerExit', 'preIntegrityExit', 'postIntegrityExit', 'validationExit'],
                    [None if x == 'null' else int(x) for x in [process, logger, pre, post, validation]]))
    status = ('timed-out' if codes['processExit'] in (124, 137) else
              'blocked' if not completed else 'passed' if all(x == 0 for x in codes.values()) else 'failed')
    write(evidence / f'{stage}.status.json', dict(stage=stage, variant=variant, completed=completed, status=status, **codes))

def main():
    op, *args = sys.argv[1:]
    if op == 'plan':
        write(Path(args[0]) / 'quality-plan.json', {'schemaVersion': 1, 'stages': STAGES,
              'variants': {v: dict(zip(['commit', 'tree'], source_spec(v)), pristine=v == 'baseline', sourceRoot=str(Path(os.environ['GITHUB_WORKSPACE']) / ('quality-' + v)), evidenceRoot=str(Path(args[0]) / v), cacheRoot=str(Path(os.environ['QUALITY_TMP']) / v)) for v in ['candidate', 'baseline']},
              'status': 'Runtime execution plan, not a pass claim'})
        for variant in ['candidate', 'baseline']:
            for stage in STAGES:
                write(Path(args[0]) / variant / (stage + '.status.json'), {'stage': stage, 'variant': variant, 'completed': False, 'status': 'not-run', 'processExit': None, 'loggerExit': None, 'preIntegrityExit': None, 'postIntegrityExit': None, 'validationExit': None})
    elif op in ('prepare', 'audit'):
        variant, root, evidence, *tail = args
        if op == 'prepare': prepare(variant, Path(root).resolve(), Path(evidence))
        else: audit(variant, Path(root).resolve(), Path(evidence), *tail)
    elif op == 'validate': validate(Path(args[0]).resolve(), Path(args[1]), args[2])
    elif op == 'command': record_command(Path(args[0]), args[1], Path(args[2]), args[3], args[4:])
    elif op == 'status': write_status(Path(args[0]), *args[1:-1], args[-1] == 'true')
    elif op == 'css-deliverable':
        root, evidence = Path(args[0]), Path(args[1])
        target = evidence / 'native-css'
        target.mkdir()
        relative = CSS['mainOutput']
        shutil.copyfile(root / relative, target / 'arco.min.css')
        if digest(root / relative) != digest(target / 'arco.min.css'): raise ValueError('CSS artifact copy differs')
        write(target / 'provenance.json', {
            'source': json.loads((evidence / 'source.json').read_text()),
            'command': json.loads((evidence / 'build-css.command.json').read_text()),
            'mainOutput': relative, 'sha256': digest(target / 'arco.min.css'),
            'before': json.loads((evidence / 'build-css.pre.integrity.json').read_text()),
            'after': json.loads((evidence / 'build-css.post.integrity.json').read_text()),
            'runtime': json.loads((evidence / 'runtime.json').read_text()),
            'claim': 'Original native CSS build bytes only; no browser validation claim'})
    elif op == 'snapshot-keys':
        root, evidence = Path(args[0]), Path(args[1])
        keys = []
        for p in sorted((root / 'components/Slider/__test__/__snapshots__').glob('*.snap')):
            keys.extend(re.findall(r'^exports\[`(.*?)`\]', p.read_text(), re.M))
        write(evidence / 'slider-client.snapshot-keys.json', keys)
    elif op == 'toolchain':
        evidence = Path(args[0])
        root = BUNDLE / 'toolchain'
        paths = [str(p.relative_to(root)) for p in (root / 'node_modules').rglob('*') if p.is_file() or p.is_symlink()]
        current = inventory(root, paths)
        anchor = evidence / 'toolchain.files.json'
        if args[1] == 'anchor': write(anchor, current)
        elif current['sha256'] != json.loads(anchor.read_text())['sha256']: raise ValueError('Isolated Yarn toolchain changed')
        print('Toolchain inventory: ' + current['sha256'])
    elif op == 'coverage':
        root, evidence, stage = Path(args[0]), Path(args[1]), args[2]
        coverage = root / '.coverage'
        report = {'errors': [], 'complete': False}
        try:
            if not coverage.is_dir() or coverage.is_symlink(): raise ValueError('Missing native client coverage directory')
            target = evidence / f'{stage}.coverage'
            paths = [str(p.relative_to(coverage)) for p in coverage.rglob('*') if p.is_file() or p.is_symlink()]
            before = inventory(coverage, paths)
            shutil.copytree(coverage, target, symlinks=True)
            after = inventory(target, paths)
            if before['sha256'] != after['sha256']: raise ValueError('Coverage evidence copy differs')
            write(evidence / f'{stage}.coverage-inventory.json', before)
            for relative in ['coverage-final.json', 'coverage-summary.json', 'lcov.info', 'clover.xml', 'lcov-report/index.html']:
                if not (target / relative).is_file() or (target / relative).stat().st_size == 0:
                    raise ValueError('Missing/empty native coverage report: ' + relative)
            final = json.loads((target / 'coverage-final.json').read_text())
            summary = json.loads((target / 'coverage-summary.json').read_text())
            if not isinstance(final, dict) or not final: raise ValueError('Empty native instrumented-file coverage')
            for filename in final:
                if not filename.startswith(str(root / 'components') + '/'):
                    raise ValueError('Coverage file is outside configured components source')
            for metric in ['lines', 'statements', 'functions', 'branches']:
                count = summary.get('total', {}).get(metric, {}).get('total')
                if not isinstance(count, int) or count < 0: raise ValueError('Malformed coverage summary: ' + metric)
            if summary['total']['statements']['total'] == 0: raise ValueError('No native covered statements were collected')
            lcov = (target / 'lcov.info').read_text()
            if 'SF:' not in lcov or 'end_of_record' not in lcov: raise ValueError('Malformed LCOV output')
            if ET.parse(target / 'clover.xml').getroot().tag != 'coverage': raise ValueError('Malformed Clover output')
            report['complete'] = True
            report['sha256'] = before['sha256']
        except Exception as error:
            report['errors'].append(str(error))
        write(evidence / f'{stage}.coverage-validation.json', report)
        if report['errors'] and (evidence / f'{stage}.exit-code').read_text().strip() == '0':
            raise ValueError('; '.join(report['errors']))
    else: raise ValueError('Unknown operation')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('QUALITY INTEGRITY FAILURE: ' + str(error), file=sys.stderr)
        sys.exit(1)
