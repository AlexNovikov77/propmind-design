// Capture and verify the documented synthetic room workflow. Run the local server first.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PROPMIND_BASE_URL || 'http://127.0.0.1:8080/propmind-design/';
const output = new URL('../artifacts/showcase/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const title = '[ДЕМО] Помещение 706 — не указано назначение';
const errors = [];
try {
  for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + 'evidence/');
    await page.locator('#add-finding').click();
    for (const [name, value] of Object.entries({
      title, project: '[ДЕМО] Офисный корпус, этаж 7', owner: '[ДЕМО] Координатор проекта',
      sourceFile: 'DEMO_FLOOR_7_R01.pdf', revision: 'Учебная R01',
      excerpt: 'Вымышленный пример: у помещения 706 не заполнено назначение. Учебная координатная область; исходный PDF не поставляется.',
      pdfPage: '1', pdfX: '20', pdfY: '30', pdfWidth: '15', pdfHeight: '10',
    })) await page.locator(`[name="${name}"]`).fill(value);
    await page.getByRole('button', { name: 'Сохранить замечание', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.locator('#detail-content .status-draft').waitFor();
    await page.screenshot({ path: output + `${label}-01-draft.png` });
    await page.locator('#reviewer').fill('[ДЕМО] Проверяющий');
    await page.locator('#review-note').fill('Учебная проверка интерфейса, без приёмки документации');
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await page.locator('#detail-content .status-confirmed').waitFor();
    await page.screenshot({ path: output + `${label}-02-confirmed.png` });
    await page.locator('#edit-finding').click();
    await page.locator('[name=revision]').fill('Учебная R02');
    await page.getByRole('button', { name: 'Сохранить замечание', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.locator('#detail-content .status-draft').waitFor();
    await page.locator('#detail-dialog details').evaluate(element => { element.open = true; });
    await page.locator('#detail-dialog .dialog-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: output + `${label}-03-recheck.png` });
    await page.getByRole('button', { name: 'Закрыть карточку', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.locator('#export-json').click();
    const download = await downloading;
    await download.saveAs(output + `${label}-room-706.json`);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.findings.length, 1);
    const finding = exported.findings[0];
    assert.equal(finding.status, 'draft');
    assert.equal(finding.revision, 'Учебная R02');
    assert.equal(finding.sourceFile, 'DEMO_FLOOR_7_R01.pdf');
    assert.equal(finding.location.page, 1);
    assert.equal(finding.history.some(event => event.type === 'confirmed'), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.close();
    console.log(`${label}: room-706 draft / confirm / revise / export passed`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
