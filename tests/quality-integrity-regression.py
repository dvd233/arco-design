#!/usr/bin/env python3
"""Dependency-free synthetic guard tests. These are NOT native package validation."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
path = Path(__file__).resolve().parents[1] / 'scripts/quality-integrity.py'
spec = importlib.util.spec_from_file_location('quality', path)
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)

class Guards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='quality-synthetic-')
        self.base = Path(self.temp.name)
        self.root = self.base / 'source'
        self.evidence = self.base / 'evidence'
        self.root.mkdir()
        self.evidence.mkdir()
        os.environ['RUNNER_TEMP'] = str(self.base)
        self.put('tracked.ts', 'original source\n')
        self.put('tests/example.snap', 'original snapshot\n')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Synthetic guard test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
        q.SOURCE['baseCommit'] = self.git('rev-parse', 'HEAD')
        q.SOURCE['baseTree'] = self.git('rev-parse', 'HEAD^{tree}')
        q.prepare('baseline', self.root, self.evidence)
    def tearDown(self):
        self.temp.cleanup()
    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL).decode().strip()
    def put(self, name, content):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    def audit(self, stage, boundary='post'):
        q.audit('baseline', self.root, self.evidence, stage, boundary)
    def install(self):
        self.put('node_modules/example/package.json', '{"name":"example"}')
        self.audit('root-install')
    def three_commit_chain(self):
        self.put('tracked.ts', 'reviewed fix\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Synthetic guard test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'reviewed fix')
        q.SOURCE['candidateParent'] = self.git('rev-parse', 'HEAD')
        q.SOURCE['candidateParentTree'] = self.git('rev-parse', 'HEAD^{tree}')
        self.put('tracked.ts', 'reviewed fix  \n')
        self.git('add', '.')
        self.git('-c', 'user.name=Synthetic guard test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'format only')
    def test_exact_candidate_parent_and_grandparent(self):
        self.three_commit_chain()
        q.native.verify_candidate_ancestry(self.root)
        q.SOURCE['candidateParent'] = q.SOURCE['baseCommit']
        with self.assertRaisesRegex(ValueError, 'direct parent'): q.native.verify_candidate_ancestry(self.root)
    def test_wrong_candidate_grandparent_rejected(self):
        self.three_commit_chain()
        q.SOURCE['baseCommit'] = q.SOURCE['candidateParent']
        with self.assertRaisesRegex(ValueError, 'base parent'): q.native.verify_candidate_ancestry(self.root)
    def test_wrong_candidate_parent_tree_rejected(self):
        self.three_commit_chain()
        q.SOURCE['candidateParentTree'] = '0' * 40
        with self.assertRaisesRegex(ValueError, 'parent tree'): q.native.verify_candidate_ancestry(self.root)
    def test_empty_fresh_source_passes(self):
        self.audit('changed-eslint', 'pre')
    def test_root_install_is_anchored(self):
        self.install()
        self.audit('changed-eslint', 'pre')
        state = json.loads((self.evidence / 'state.json').read_text())
        self.assertEqual(set(state['anchors']), {'node_modules/'})
    def test_dependency_mutation_fails(self):
        self.install()
        self.put('node_modules/example/package.json', '{"name":"changed"}')
        with self.assertRaisesRegex(ValueError, 'Immutable'): self.audit('changed-eslint')
    def test_tracked_source_mutation_fails(self):
        self.put('tracked.ts', 'mutated\n')
        with self.assertRaisesRegex(ValueError, 'source'): self.audit('changed-prettier')
    def test_snapshot_mutation_fails(self):
        self.put('tests/example.snap', 'updated\n')
        with self.assertRaisesRegex(ValueError, 'source'): self.audit('slider-client')
    def test_site_install_cannot_modify_root_dependencies(self):
        self.install()
        self.put('site/node_modules/demo/package.json', '{}')
        self.put('node_modules/example/package.json', 'changed')
        with self.assertRaisesRegex(ValueError, 'Immutable'): self.audit('site-install')
    def test_site_install_has_its_own_anchor(self):
        self.install()
        self.put('site/node_modules/demo/package.json', '{}')
        self.audit('site-install')
        self.audit('client-list', 'pre')
    def test_cjs_cannot_create_dist_or_es(self):
        self.put('dist/arco.js', 'unexpected')
        self.put('es/index.js', 'unexpected')
        with self.assertRaisesRegex(ValueError, 'Unexpected'): self.audit('build-cjs')
    def test_cjs_then_es_keep_cjs_frozen(self):
        self.put('lib/index.js', 'cjs')
        self.put('hooks/lib/index.js', 'hooks')
        self.audit('build-cjs')
        self.put('es/index.js', 'es')
        self.put('lib/index.js', 'changed')
        with self.assertRaisesRegex(ValueError, 'Immutable'): self.audit('build-es')
    def test_css_cannot_change_component_logic(self):
        self.put('lib/Slider/hooks/useLegalValue.js', 'native')
        self.audit('build-cjs')
        self.put('lib/Slider/hooks/useLegalValue.js', 'tampered')
        with self.assertRaisesRegex(ValueError, 'CSS touched'): self.audit('build-css')
    def test_css_exact_addition_allowed(self):
        self.put('dist/css/arco.min.css', 'css')
        self.audit('build-css')
    def test_css_unlisted_asset_rejected(self):
        self.put('dist/asset/unlisted.svg', 'svg')
        with self.assertRaisesRegex(ValueError, 'CSS touched'): self.audit('build-css')
    def test_external_symlink_rejected(self):
        (self.root / 'node_modules').mkdir()
        (self.root / 'node_modules/escape').symlink_to(self.base / 'evidence', target_is_directory=True)
        with self.assertRaises(ValueError): self.audit('root-install')
    def test_coverage_writer_cannot_modify_builds(self):
        self.put('lib/index.js', 'cjs')
        self.audit('build-cjs')
        self.put('.coverage/coverage-final.json', '{}')
        self.put('lib/index.js', 'changed')
        with self.assertRaisesRegex(ValueError, 'Immutable'): self.audit('full-client')
    def test_node_must_preserve_client_coverage(self):
        self.put('.coverage/coverage-final.json', '{}')
        self.audit('full-client')
        self.put('.coverage/coverage-final.json', '{"changed":true}')
        with self.assertRaisesRegex(ValueError, 'Immutable'): self.audit('full-node')
    def test_two_coverage_writers_get_distinct_anchors(self):
        self.put('.coverage/coverage-final.json', '{}')
        self.audit('slider-client')
        self.put('.coverage/coverage-final.json', '{"full":true}')
        self.audit('full-client')
        self.assertTrue((self.evidence / 'slider-client..coverage_.files.json').exists())
        self.assertTrue((self.evidence / 'full-client..coverage_.files.json').exists())
    def test_failed_audit_does_not_replace_anchor(self):
        self.install()
        before = (self.evidence / 'state.json').read_bytes()
        self.put('dist/not-allowed', 'bad')
        with self.assertRaises(ValueError): self.audit('site-install')
        self.assertEqual(before, (self.evidence / 'state.json').read_bytes())

class Parsing(unittest.TestCase):
    def test_yarn_wrapper_json(self):
        v = q.parse_embedded_json('yarn run v1\n$ cmd\n[Arco]: banner\n{\n"configs":[],"globalConfig":{}\n}\nDone in 1s.\n', 'config')
        self.assertEqual(v['configs'], [])
    def test_ambiguous_json_fails(self):
        with self.assertRaises(ValueError): q.parse_embedded_json('["one"]\n["two"]\n', 'list')
    def test_missing_json_fails(self):
        with self.assertRaises(ValueError): q.parse_embedded_json('No tests\n', 'list')
    def test_native_global_coverage_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            payload = {'configs': [{'rootDir': str(p), 'name': hashlib.md5((str(p) + '0').encode()).hexdigest(), 'testEnvironment': str(p / 'node_modules/jest-environment-jsdom/build/index.js'), 'testRegex': ['.*\\.test\\.(j|t)sx?$']}], 'globalConfig': {'collectCoverage': True, 'coverageDirectory': str(p / '.coverage')}}
            (p / 'client-show-config.log').write_text(json.dumps(payload, indent=2))
            q.validate(p, p, 'client-show-config')
    def test_successful_client_requires_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'full-client.exit-code').write_text('0')
            old = sys.argv
            try:
                sys.argv = ['quality-integrity.py', 'coverage', str(root), str(root), 'full-client']
                with self.assertRaisesRegex(ValueError, 'Missing native client coverage'): q.main()
            finally: sys.argv = old
    def test_native_coverage_copy_is_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            coverage = root / '.coverage'
            coverage.mkdir()
            (root / 'full-client.exit-code').write_text('0')
            (coverage / 'coverage-final.json').write_text(json.dumps({str(root / 'components/example.ts'): {}}))
            (coverage / 'coverage-summary.json').write_text(json.dumps({'total': {k: {'total': 1} for k in ['lines', 'statements', 'functions', 'branches']}}))
            (coverage / 'lcov.info').write_text('SF:components/example.ts\nend_of_record\n')
            (coverage / 'clover.xml').write_text('<coverage/>')
            (coverage / 'lcov-report').mkdir()
            (coverage / 'lcov-report/index.html').write_text('<html>synthetic</html>')
            old = sys.argv
            try:
                sys.argv = ['quality-integrity.py', 'coverage', str(root), str(root), 'full-client']
                q.main()
                report = json.loads((root / 'full-client.coverage-validation.json').read_text())
                self.assertTrue(report['complete'])
                self.assertEqual(report['errors'], [])
            finally: sys.argv = old
    def test_css_empty_allowance_is_exact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'build-css.log').write_text('Build css success!')
            old = q.CSS
            try:
                q.CSS = {'outputFiles': ['es/Icon/style/css.js'], 'expectedCopies': {}, 'permittedEmptyOutputs': {'es/Icon/style/css.js': {'sha256': hashlib.sha256(b'').hexdigest()}}}
                output = root / 'es/Icon/style/css.js'
                output.parent.mkdir(parents=True)
                output.write_bytes(b'')
                q.validate(root, root, 'build-css')
                output.write_text('unexpected')
                with self.assertRaisesRegex(ValueError, 'empty CSS entry differs'): q.validate(root, root, 'build-css')
            finally: q.CSS = old
    def test_unlisted_empty_css_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'build-css.log').write_text('Build css success!')
            old = q.CSS
            try:
                q.CSS = {'outputFiles': ['arco.min.css'], 'expectedCopies': {}, 'permittedEmptyOutputs': {}}
                (root / 'arco.min.css').write_bytes(b'')
                with self.assertRaisesRegex(ValueError, 'Missing/empty'): q.validate(root, root, 'build-css')
            finally: q.CSS = old
    def test_zero_exit_compiler_diagnostic_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'build-css.log').write_text('Failed to update style')
            with self.assertRaisesRegex(ValueError, 'Compiler failure'): q.validate(root, root, 'build-css')
    def test_disabled_client_coverage_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / 'client-show-config.log').write_text(json.dumps({'configs': [{'rootDir': str(p), 'name': hashlib.md5((str(p) + '0').encode()).hexdigest()}], 'globalConfig': {'collectCoverage': False}}))
            with self.assertRaisesRegex(ValueError, 'coverage'): q.validate(p, p, 'client-show-config')

if __name__ == '__main__': unittest.main()
