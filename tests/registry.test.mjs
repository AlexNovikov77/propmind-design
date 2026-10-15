import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, BACKUP_KEY, emptyRegistry, createFinding, editFinding,
  transitionFinding, evidenceGaps, replaceFinding, parseRegistry,
  saveRegistry, importRegistry, filterFindings,
} from '../assets/registry.mjs';

const now = '2026-10-15T12:00:00.000Z';
const later = '2026-10-15T12:30:00.000Z';
const pdf = () => ({
  title: 'Не указана марка клапана', project: 'Учебный объект', pipeline: 'PDF Scan',
  severity: 'high', owner: 'Инженер ОВ', sourceFile: 'ОВ.pdf', revision: 'R01',
  excerpt: 'Клапан К1: марка не указана.', location: { page: 2, x: 0, y: 20, width: 30, height: 10 },
});
const finding = (overrides = {}) => createFinding({ ...pdf(), ...overrides }, { id: 'ER-test', now });
const registry = record => replaceFinding(emptyRegistry(now), record, now);
const confirm = record => transitionFinding(record, 'confirmed', { actor: 'Алексей', now: later });
function memoryStorage(failKey = '') {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem(key, value) { if (key === failKey) throw new Error('QuotaExceededError'); values.set(key, value); } };
}

test('draft permits incomplete evidence without inventing coordinates', () => {
  const record = finding({ sourceFile: '', revision: '', owner: '', excerpt: '', location: {} });
  assert.equal(record.status, 'draft');
  assert.equal(record.location.x, null);
  assert.ok(evidenceGaps(record).includes('исходный файл'));
  assert.throws(() => confirm(record), /Для подтверждения заполните/);
});
test('human confirmation requires an actor and preserves zero coordinates', () => {
  assert.throws(() => transitionFinding(finding(), 'confirmed', { actor: '   ', now }), /Проверяющий/);
  const checked = confirm(finding());
  assert.equal(checked.review.by, 'Алексей');
  assert.equal(checked.location.x, 0);
  assert.equal(checked.history.at(-1).type, 'confirmed');
});
test('PDF rejects outside boxes, invalid pages and nonnumeric coordinates', () => {
  for (const location of [
    { page: 0 }, { page: 1.5 }, { x: -1 }, { x: 90, width: 20 },
    { y: 95, height: 10 }, { x: 'NaN' }, { x: true },
  ]) assert.throws(() => finding({ location }));
  const zeroArea = finding({ location: { page: 1, x: 0, y: 0, width: 0, height: 10 } });
  assert.throws(() => confirm(zeroArea), /область PDF/);
});
test('IFC confirmation needs GlobalId and three model coordinates; zero and negative values are valid', () => {
  const input = { ...pdf(), pipeline: 'IFC Deep Check', location: { globalId: 'DEMO-GUID', x: 0, y: -4, z: 3.5 } };
  assert.equal(confirm(finding(input)).location.y, -4);
  assert.throws(() => confirm(finding({ ...input, location: { ...input.location, z: '' } })), /координаты IFC/);
  assert.throws(() => confirm(finding({ ...input, location: { ...input.location, globalId: '' } })), /IFC GlobalId/);
});
test('editing confirmed evidence resets approval and preserves history', () => {
  const checked = confirm(finding());
  const edited = editFinding(checked, { ...pdf(), revision: 'R02' }, later);
  assert.equal(edited.status, 'draft');
  assert.equal(edited.review, null);
  assert.equal(checked.review.by, 'Алексей');
  assert.deepEqual(edited.history.map(e => e.type), ['created', 'confirmed', 'updated']);
});
test('saving unchanged confirmed content keeps human confirmation', () => {
  const checked = confirm(finding());
  assert.equal(editFinding(checked, pdf(), later), checked);
});
test('a draft cannot be resolved; closure requires actor and rationale', () => {
  assert.throws(() => transitionFinding(finding(), 'resolved', { actor: 'А', note: 'Готово', now }), /переход/);
  assert.throws(() => transitionFinding(confirm(finding()), 'resolved', { actor: 'А', now }), /Комментарий/);
  const closed = transitionFinding(confirm(finding()), 'resolved', { actor: 'А', note: 'Проверен лист R02', now: later });
  assert.equal(closed.status, 'resolved');
  assert.equal(closed.disposition.note, 'Проверен лист R02');
  const reopened = transitionFinding(closed, 'draft', { actor: 'А', note: 'Новая ревизия', now: later });
  assert.equal(reopened.review, null);
  assert.equal(reopened.disposition, null);
});
test('a rejected finding remains in the register with the reason', () => {
  const rejected = transitionFinding(finding(), 'dismissed', { actor: 'Проверяющий', note: 'Дубликат ER-002', now });
  assert.equal(rejected.status, 'dismissed');
  assert.equal(registry(rejected).findings.length, 1);
  assert.equal(rejected.history.at(-1).note, 'Дубликат ER-002');
});
test('JSON export/import round-trips source, coordinates, human review and history', () => {
  const data = registry(confirm(finding()));
  assert.deepEqual(parseRegistry(JSON.stringify(data)), data);
});
test('unsupported, damaged, duplicated and incomplete imports are rejected', () => {
  assert.throws(() => parseRegistry('broken'), /JSON/);
  assert.throws(() => parseRegistry('{"schemaVersion":2,"findings":[]}'), /версия/);
  const data = registry(finding());
  data.findings.push(data.findings[0]);
  assert.throws(() => parseRegistry(JSON.stringify(data)), /повторяются/);
  const broken = registry(confirm(finding()));
  broken.findings[0].review = null;
  assert.throws(() => parseRegistry(JSON.stringify(broken)), /подтверждение/);
  broken.findings[0].review = { by: 'А', at: now, note: '' };
  broken.findings[0].location.page = null;
  assert.throws(() => parseRegistry(JSON.stringify(broken)), /неполное доказательство/);
});
test('import requires creation timestamps and valid audit events', () => {
  const data = registry(finding());
  delete data.findings[0].createdAt;
  assert.throws(() => parseRegistry(JSON.stringify(data)), /дата/);
  data.findings[0].createdAt = now;
  data.findings[0].history[0].type = 'execute-script';
  assert.throws(() => parseRegistry(JSON.stringify(data)), /Событие/);
});
test('import rejects active approval on drafts and closure on confirmed open records', () => {
  const data = registry(confirm(finding()));
  data.findings[0].status = 'draft';
  assert.throws(() => parseRegistry(JSON.stringify(data)), /Черновик/);
  data.findings[0].status = 'confirmed';
  data.findings[0].disposition = { by: 'А', at: later, note: 'Закрыто' };
  assert.throws(() => parseRegistry(JSON.stringify(data)), /открытая запись/);
});
test('the documented 500-finding limit is enforced for creation and import', () => {
  const data = emptyRegistry(now);
  data.findings = Array.from({ length: 500 }, (_, i) => createFinding(pdf(), { id: `ER-${i}`, now }));
  assert.throws(() => replaceFinding(data, finding()), /лимит 500/);
  data.findings.push(finding());
  assert.throws(() => parseRegistry(JSON.stringify(data)), /не более 500/);
});
test('unknown object properties are dropped, user text remains plain text', () => {
  const data = registry(finding({ title: '<img src=x onerror=alert(1)>' }));
  data.findings[0].unexpected = { dangerous: true };
  const parsed = parseRegistry(JSON.stringify(data));
  assert.equal(parsed.findings[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(parsed.findings[0].unexpected, undefined);
});
test('quota failure leaves the previous persisted register intact', () => {
  const storage = memoryStorage(STORAGE_KEY);
  storage.values.set(STORAGE_KEY, 'previous-value');
  assert.throws(() => saveRegistry(storage, registry(finding())), /не смог сохранить/);
  assert.equal(storage.getItem(STORAGE_KEY), 'previous-value');
});
test('a valid import backs up the full previous registry before replacement', () => {
  const storage = memoryStorage();
  const before = registry(finding());
  const incoming = emptyRegistry(later);
  saveRegistry(storage, before);
  assert.deepEqual(importRegistry(storage, before, incoming), incoming);
  assert.deepEqual(parseRegistry(storage.getItem(BACKUP_KEY)), before);
  assert.deepEqual(parseRegistry(storage.getItem(STORAGE_KEY)), incoming);
});
test('backup failure and invalid incoming data never replace the current registry', () => {
  const storage = memoryStorage(BACKUP_KEY);
  const before = registry(finding());
  saveRegistry(storage, before);
  assert.throws(() => importRegistry(storage, before, emptyRegistry(later)), /Импорт отменён/);
  assert.deepEqual(parseRegistry(storage.getItem(STORAGE_KEY)), before);
  assert.throws(() => importRegistry(storage, before, { schemaVersion: 99 }), /версия/);
  assert.equal(storage.getItem(BACKUP_KEY), null);
});
test('filters combine text, pipeline, severity and status without mutating records', () => {
  const records = [finding(), createFinding({ ...pdf(), title: 'Серийный номер', sourceFile: 'MEP.ifc', pipeline: 'IFC Deep Check', location: {}, severity: 'critical' }, { id: 'ER-2', now })];
  assert.equal(filterFindings(records, { search: 'ОВ.PDF'.toLowerCase() }).length, 1);
  assert.equal(filterFindings(records, { pipeline: 'IFC Deep Check', status: 'draft', severity: 'critical' })[0].id, 'ER-2');
  assert.equal(records.length, 2);
});
