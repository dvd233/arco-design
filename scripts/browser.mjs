import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { ROOT, argsOf, hashFile, json, writeJson } from './source.mjs';
import { SCENARIOS } from './spec.mjs';
import { classify } from './classify.mjs';
import { readAttestedPhase } from './phase.mjs';

// This guard runs before a listener or browser is created. Never use a local fallback.
const manifest = await json(path.join(ROOT,'source-manifest.json'));
assert.equal(manifest.state,'frozen-audited','Draft harness is not approved for browser execution');
assert.equal(process.env.GITHUB_ACTIONS,'true'); assert.equal(process.env.CI,'true');
assert.equal(process.env.GITHUB_REPOSITORY,manifest.execution.repository);
assert.ok(manifest.execution.repositoryId && manifest.execution.ownerId);
assert.equal(process.env.GITHUB_REPOSITORY_ID,manifest.execution.repositoryId);
assert.equal(process.env.GITHUB_REPOSITORY_OWNER_ID,manifest.execution.ownerId);
assert.equal(process.env.GITHUB_REF,manifest.execution.ref);
assert.ok(['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME));
assert.match(process.env.GITHUB_RUN_ID || '',/^\d+$/);
assert.match(process.env.GITHUB_RUN_ATTEMPT || '',/^\d+$/);
const args = argsOf(), variant = args.variant, dist = path.resolve(args.dist), out = path.resolve(args.out);
const source = path.resolve(args.source);
assert.ok(['baseline','fixed'].includes(variant));
await fs.mkdir(out,{ recursive:true });
const report = {
  schemaVersion:1, variant, completed:false, errors:[], scenarios:[],
  status:'infrastructure-error', exitCode:2, runId:process.env.GITHUB_RUN_ID,
  runAttempt:process.env.GITHUB_RUN_ATTEMPT, validationCommit:process.env.GITHUB_SHA,
  startedAt:new Date().toISOString(),
};
let server,browser,context;
try {
  const before = await readAttestedPhase(source,variant,'pre-browser',out);
  const provenance = await json(path.join(dist,'build-provenance.json'));
  report.provenance = provenance;
  assert.equal(provenance.variant,variant);
  assert.equal(provenance.commit,manifest[variant === 'baseline' ? 'baseline' : 'candidate'].sha);
  assert.equal(provenance.harnessLockSha256,manifest.harnessLockSha256);
  assert.equal(provenance.commit,before.source.commit);
  for (const label of ['dependencies','icons-es','icons-cjs','css']) assert.deepEqual(provenance.inputAnchors[label],before.inventory[label]);
  for (const [file,hash] of Object.entries(provenance.artifactHashes)) {
    assert.ok(['index.html','bundle.js','bundle.css','bundle.js.map','bundle.css.map'].includes(file));
    assert.equal(await hashFile(path.join(dist,file)),hash);
  }
  assert.deepEqual(Object.keys(provenance.artifactHashes).sort(),['index.html','bundle.js','bundle.css','bundle.js.map','bundle.css.map'].sort());
  const allowed = new Set(Object.keys(provenance.artifactHashes));
  server = http.createServer(async (request,response) => {
    const file = new URL(request.url,'http://127.0.0.1').pathname.slice(1) || 'index.html';
    if (!allowed.has(file)) { response.writeHead(404); response.end(); return; }
    try {
      response.setHeader('Content-Type',file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.map') ? 'application/json' : 'text/html');
      response.end(await fs.readFile(path.join(dist,file)));
    } catch(error) { report.errors.push(`Static server: ${error.message}`); response.writeHead(500); response.end(); }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless:true, chromiumSandbox:true });
  report.browserVersion = browser.version();
  assert.equal(browser.version(),manifest.runtime.chromiumVersion);
  for (const scenario of SCENARIOS) {
    const entry = { id:scenario.id, completed:false, checkpoints:[] };
    report.scenarios.push(entry);
    context = await browser.newContext({ viewport:{ width:1000,height:900 },deviceScaleFactor:1,reducedMotion:'reduce' });
    await context.tracing.start({ screenshots:true,snapshots:true,sources:true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror',error => report.errors.push(`pageerror: ${error.message}`));
    page.on('console',message => { if (message.type() === 'error') report.errors.push(`console.error: ${message.text()}`); });
    page.on('requestfailed',request => report.errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response',response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    await page.route('**/*',route => {
      if (new URL(route.request().url()).origin !== origin) {
        report.errors.push(`Unexpected network request: ${route.request().url()}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const response = await page.goto(`${origin}/?scenario=${scenario.id}`,{ waitUntil:'networkidle' });
    assert.equal(response.status(),200);
    await page.waitForFunction(() => window.validation?.ready === true);
    const runtime = await page.evaluate(() => window.validation.provenance);
    for (const field of ['variant','commit','tree','sourceLockSha256','harnessLockSha256']) assert.equal(runtime[field],provenance[field]);
    const thumbs = page.locator('[role="slider"]');
    const thumbCount = Array.isArray(scenario.initial) ? scenario.initial.length : 1;
    assert.equal(await thumbs.count(),thumbCount);
    for (let thumb=0; thumb<thumbCount; thumb++) {
      assert.equal(await thumbs.nth(thumb).getAttribute('aria-valuemin'),String(scenario.props.min));
      assert.equal(await thumbs.nth(thumb).getAttribute('aria-valuemax'),String(scenario.props.max));
      assert.equal(await thumbs.nth(thumb).getAttribute('aria-disabled'),String(!!scenario.props.disabled));
      assert.equal(await thumbs.nth(thumb).getAttribute('tabindex'),scenario.props.disabled ? '-1' : '0');
      assert.equal(await thumbs.nth(thumb).isVisible(),true);
    }
    const rootClass = await page.locator('#slider-area > .arco-slider').getAttribute('class');
    assert.equal(rootClass.split(' ').includes('arco-slider-vertical'),!!scenario.props.vertical);
    assert.equal(rootClass.split(' ').includes('arco-slider-rtl'),!!scenario.rtl);
    assert.equal(rootClass.split(' ').includes('arco-slider-reverse'),scenario.rtl ? !scenario.props.reverse : !!scenario.props.reverse);
    async function capture(name) {
      await page.screenshot({ path:path.join(out,name),fullPage:true });
      return { path:name,sha256:await hashFile(path.join(out,name)) };
    }
    async function snapshot() {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return page.evaluate(() => ({
        values:Array.from(document.querySelectorAll('[role="slider"]'),element => Number(element.getAttribute('aria-valuenow'))),
        events:JSON.parse(JSON.stringify(window.validation.events)),
        accepted:JSON.parse(JSON.stringify(window.validation.accepted)),
        keyEvents:JSON.parse(JSON.stringify(window.validation.keyEvents)),
      }));
    }
    entry.initial = await snapshot();
    entry.readyScreenshot = await capture(`${scenario.id}-ready.png`);
    // Tab from a real preceding control verifies normal keyboard entry, including disabled skip.
    await page.locator('#before').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id),scenario.props.disabled ? 'after' : '');
    if (!scenario.props.disabled) assert.equal(await thumbs.first().evaluate(element => element === document.activeElement),true);
    for (const [index,step] of scenario.steps.entries()) {
      if (step.action === 'accept') await page.locator('#accept').click();
      else {
        await page.locator('#before').focus();
        if (scenario.props.disabled) await thumbs.nth(step.thumb).focus();
        else for (let count=0; count<=step.thumb; count++) await page.keyboard.press('Tab');
        assert.equal(await thumbs.nth(step.thumb).evaluate(element => element === document.activeElement),true);
        await page.keyboard.press(step.press);
        assert.equal(await thumbs.nth(step.thumb).evaluate(element => element === document.activeElement),true);
      }
      entry.checkpoints.push({ step,actual:await snapshot(),screenshot:await capture(`${scenario.id}-${String(index+1).padStart(2,'0')}.png`) });
    }
    const trace = `${scenario.id}-trace.zip`;
    await context.tracing.stop({ path:path.join(out,trace) });
    entry.trace = { path:trace,sha256:await hashFile(path.join(out,trace)) };
    await context.close(); context = undefined;
    entry.completed = true;
  }
  report.completed = true;
  Object.assign(report,classify(report));
} catch(error) {
  report.errors.push(String(error.stack || error)); report.status='infrastructure-or-unexpected-semantics-error'; report.exitCode=2;
} finally {
  try { await context?.close(); await browser?.close(); if (server) await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
  catch(error) { report.errors.push(`Cleanup: ${error.message}`); report.exitCode=2; }
  // The outer runner records the actual exit before doing the post-browser gate.
  report.finishedAt = new Date().toISOString();
  await writeJson(path.join(out,'results.json'),report);
}
process.exitCode = report.exitCode;
