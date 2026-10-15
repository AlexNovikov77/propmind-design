// Optional development tool: npm install --no-save --package-lock=false playwright
// Start python3 scripts/serve.py before running this script.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { throw new Error('Install Playwright: npm install --no-save --package-lock=false playwright'); }

const base = process.env.PROPMIND_BASE_URL || 'http://127.0.0.1:8080/propmind-design/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const key = 'propmind.evidence.v1';
const artifacts = new URL('../artifacts/', import.meta.url).pathname;
await mkdir(artifacts, { recursive: true });

async function visible(locator) { await locator.waitFor({ state: 'visible' }); }
async function closeDetail(target = page) { await target.getByRole('button', { name: 'Закрыть карточку', exact: true }).click(); }
async function createDraft(target, title, project = '[ДЕМО] Проверка интерфейса') {
  await target.locator('#add-finding').click();
  await target.locator('[name=title]').fill(title);
  await target.locator('[name=project]').fill(project);
  await target.getByRole('button', { name: 'Сохранить замечание', exact: true }).click();
}
try {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['', 'evidence/', 'concepts/liquid-glass/', 'b24/']) {
      await page.goto(base + route);
      if (route === 'evidence/') await visible(page.locator('#empty-add'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Page overflow at ${width}: ${route}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await page.screenshot({ path: artifacts + 'home-desktop.png', fullPage: true });
  await page.goto(base + 'evidence/?pipeline=ifc');
  assert.equal(await page.locator('#pipeline-filter').inputValue(), 'IFC Deep Check');
  await page.locator('#add-finding').click();
  assert.equal(await page.locator('[name=pipeline]').inputValue(), 'IFC Deep Check');
  assert.equal(await page.locator('#ifc-location').isVisible(), true);
  await page.getByRole('button', { name: 'Закрыть форму', exact: true }).click();
  await page.goto(base + 'evidence/');
  await visible(page.locator('#empty-add'));
  await page.locator('#add-examples').click();
  assert.equal(await page.locator('#total-count').innerText(), '2');

  const pdfTitle = '[ДЕМО] Не указана марка противопожарного клапана';
  await page.getByRole('button', { name: pdfTitle, exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await visible(page.locator('#detail-error'));
  assert.match(await page.locator('#detail-error').innerText(), /Проверяющий/);
  await page.locator('#reviewer').fill('Проверка интерфейса');
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await visible(page.locator('#detail-content .status-confirmed'));
  await page.locator('#edit-finding').click();
  const updatedTitle = pdfTitle + ' — уточнено';
  await page.locator('[name=title]').fill(updatedTitle);
  await page.getByRole('button', { name: 'Сохранить замечание', exact: true }).click();
  await page.getByRole('button', { name: updatedTitle, exact: true }).click();
  await visible(page.locator('#detail-content .status-draft'));
  await closeDetail();
  await page.reload();
  await visible(page.getByRole('button', { name: updatedTitle, exact: true }));

  // User-provided HTML must stay text in the list and detail heading.
  const unsafeTitle = '<img src=x onerror=alert(1)>';
  await createDraft(page, unsafeTitle);
  await page.getByRole('button', { name: unsafeTitle, exact: true }).click();
  assert.equal(await page.locator('#detail-title img').count(), 0);
  await page.locator('#reviewer').fill('Тест');
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await visible(page.locator('#detail-error'));
  assert.match(await page.locator('#detail-error').innerText(), /Для подтверждения заполните/);
  await closeDetail();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.findings.length, 3);
  assert.equal(exported.findings.find(f => f.title === updatedTitle).history.some(e => e.type === 'confirmed'), true);

  await page.locator('#import-json').click();
  await page.locator('#import-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await visible(page.locator('#import-error'));
  assert.equal(await page.locator('#confirm-import').isDisabled(), true);
  assert.equal(await page.locator('#total-count').innerText(), '3');
  await page.locator('#import-file').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), findings: [] })) });
  await page.waitForFunction(() => !document.getElementById('confirm-import').disabled);
  await page.locator('#confirm-import').click();
  assert.equal(await page.locator('#total-count').innerText(), '0');
  await page.locator('#restore-backup').click();
  await page.locator('#confirm-import').click();
  assert.equal(await page.locator('#total-count').innerText(), '3');

  // A stale second tab must not overwrite the first tab's change.
  const second = await context.newPage();
  await second.goto(base + 'evidence/');
  await visible(second.getByRole('button', { name: updatedTitle, exact: true }));
  await createDraft(page, '[ДЕМО] Новая запись в первой вкладке');
  await createDraft(second, '[ДЕМО] Конфликт второй вкладки');
  await visible(second.locator('#finding-error'));
  assert.match(await second.locator('#finding-error').innerText(), /другой вкладке/);
  assert.equal(await page.locator('#total-count').innerText(), '4');
  await second.close();

  // Storage write failure leaves both persisted and displayed records untouched.
  const before = await page.evaluate(k => localStorage.getItem(k), key);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await createDraft(page, '[ДЕМО] Не должно сохраниться');
  await visible(page.locator('#finding-error'));
  assert.match(await page.locator('#finding-error').innerText(), /не смог сохранить/);
  assert.equal(await page.evaluate(k => localStorage.getItem(k), key), before);
  await page.getByRole('button', { name: 'Закрыть форму', exact: true }).click();
  await page.reload();
  await visible(page.getByRole('button', { name: updatedTitle, exact: true }));
  await page.screenshot({ path: artifacts + 'evidence-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: artifacts + 'evidence-mobile.png', fullPage: true });

  // Actual mobile form interactions, including empty IFC coordinates as a draft.
  await page.locator('#add-finding').click();
  await page.locator('[name=title]').fill('[ДЕМО] Замечание с телефона');
  await page.locator('[name=project]').fill('[ДЕМО] Мобильная проверка');
  await page.locator('[name=pipeline]').selectOption('IFC Deep Check');
  await page.getByRole('button', { name: 'Сохранить замечание', exact: true }).click();
  await page.getByRole('button', { name: '[ДЕМО] Замечание с телефона', exact: true }).click();
  await page.screenshot({ path: artifacts + 'detail-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await closeDetail();

  await page.goto(base + 'b24/');
  await page.getByRole('tab', { name: 'Канбан объектов', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Гант · график работ', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab', { name: 'Роботы · автоматизация', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.rtag').first().innerText(), 'сценарий');
  await page.goto(base + 'concepts/liquid-glass/');
  await page.getByRole('button', { name: '☀️ Светлая', exact: true }).click();
  assert.equal(await page.locator('#btnLight').getAttribute('aria-pressed'), 'true');

  for (const mode of ['denied', 'corrupt']) {
    const isolated = await browser.newContext();
    if (mode === 'denied') await isolated.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
    else await isolated.addInitScript(k => localStorage.setItem(k, 'CORRUPT-ORIGINAL'), key);
    const tab = await isolated.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto(base + 'evidence/');
    await visible(tab.locator('#notice.error'));
    assert.equal(await tab.locator('#add-finding').isDisabled(), true);
    if (mode === 'corrupt') assert.equal(await tab.evaluate(k => localStorage.getItem(k), key), 'CORRUPT-ORIGINAL');
    await isolated.close();
  }
  assert.deepEqual(errors, [], 'Unexpected browser JavaScript errors');
  console.log('OK: desktop/mobile pages, CRUD, human review, persistence, safe JSON import/restore, XSS text, tab conflicts, quota/blocked/corrupt storage, accessible concept controls.');
  console.log('Screenshots: artifacts/');
} finally {
  await browser.close();
}
