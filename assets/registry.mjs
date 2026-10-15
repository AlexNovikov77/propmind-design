// Shared browser/Node domain logic. No network, DOM or third-party dependencies.
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'propmind.evidence.v1';
export const BACKUP_KEY = 'propmind.evidence.backup.v1';
export const MAX_FINDINGS = 500;
export const PIPELINES = ['PDF Scan', 'IFC Deep Check'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const STATUSES = ['draft', 'confirmed', 'resolved', 'dismissed'];
const EVENTS = ['created', 'updated', 'confirmed', 'resolved', 'dismissed', 'reopened'];
const FIELDS = ['title', 'project', 'pipeline', 'severity', 'owner', 'sourceFile', 'revision', 'excerpt', 'location'];

export class RegistryError extends Error {}
function requireThat(condition, message) {
  if (!condition) throw new RegistryError(message);
}
function text(value, name, max = 300, optional = false) {
  requireThat(typeof value === 'string', `${name}: ожидается текст.`);
  const result = value.trim();
  requireThat((optional || result.length > 0) && result.length <= max, `${name}: заполните поле (до ${max} символов).`);
  return result;
}
function oneOf(value, values, name) {
  requireThat(values.includes(value), `${name}: недопустимое значение.`);
  return value;
}
function timestamp(value) {
  requireThat(typeof value === 'string' && /T.*(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'Некорректная дата записи.');
  return value;
}
function numberOrNull(value) {
  if (value === '' || value == null) return null;
  requireThat((typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value)), 'Координаты должны быть числами.');
  return Number(value);
}
function locationFor(pipeline, value = {}) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Некорректная привязка к источнику.');
  if (pipeline === 'PDF Scan') {
    const result = Object.fromEntries(['page', 'x', 'y', 'width', 'height'].map(k => [k, numberOrNull(value[k])]));
    requireThat(result.page === null || (Number.isInteger(result.page) && result.page > 0), 'Страница PDF должна быть целым числом от 1.');
    for (const key of ['x', 'y', 'width', 'height']) {
      requireThat(result[key] === null || (result[key] >= 0 && result[key] <= 100), 'Область PDF задаётся в процентах от 0 до 100.');
    }
    requireThat(result.x === null || result.width === null || result.x + result.width <= 100, 'Область PDF выходит за правую границу страницы.');
    requireThat(result.y === null || result.height === null || result.y + result.height <= 100, 'Область PDF выходит за нижнюю границу страницы.');
    return result;
  }
  return {
    globalId: text(value.globalId ?? '', 'IFC GlobalId', 100, true),
    x: numberOrNull(value.x), y: numberOrNull(value.y), z: numberOrNull(value.z),
  };
}
function fields(input) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Некорректная запись.');
  const pipeline = oneOf(input.pipeline, PIPELINES, 'Контур');
  return {
    title: text(input.title, 'Замечание', 200),
    project: text(input.project, 'Объект', 160),
    pipeline,
    severity: oneOf(input.severity, SEVERITIES, 'Критичность'),
    owner: text(input.owner ?? '', 'Ответственный', 160, true),
    sourceFile: text(input.sourceFile ?? '', 'Исходный файл', 240, true),
    revision: text(input.revision ?? '', 'Ревизия', 100, true),
    excerpt: text(input.excerpt ?? '', 'Исходный фрагмент', 4000, true),
    location: locationFor(pipeline, input.location),
  };
}
function addEvent(record, type, now, actor = '', note = '') {
  return [...record.history, { type, at: timestamp(now), actor, note }];
}
export function emptyRegistry(now = new Date().toISOString()) {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: timestamp(now), findings: [] };
}
export function createFinding(input, { id, now = new Date().toISOString() } = {}) {
  requireThat(typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id), 'Некорректный идентификатор.');
  return {
    id, ...fields(input), status: 'draft', createdAt: timestamp(now), updatedAt: now,
    review: null, disposition: null,
    history: [{ type: 'created', at: now, actor: '', note: 'Создано вручную' }],
  };
}
export function evidenceGaps(record) {
  const gaps = [];
  for (const [field, label] of [['sourceFile', 'исходный файл'], ['revision', 'ревизия'], ['excerpt', 'исходный фрагмент'], ['owner', 'ответственный']]) {
    if (!record[field]) gaps.push(label);
  }
  const loc = record.location;
  if (record.pipeline === 'PDF Scan') {
    if (!loc.page) gaps.push('страница PDF');
    if (['x', 'y', 'width', 'height'].some(k => loc[k] === null) || !(loc.width > 0 && loc.height > 0)) gaps.push('область PDF (x, y, ширина, высота)');
  } else {
    if (!loc.globalId) gaps.push('IFC GlobalId');
    if (['x', 'y', 'z'].some(k => loc[k] === null)) gaps.push('координаты IFC (x, y, z)');
  }
  return gaps;
}
export function editFinding(record, input, now = new Date().toISOString()) {
  const next = fields(input);
  if (FIELDS.every(k => JSON.stringify(record[k]) === JSON.stringify(next[k]))) return record;
  return {
    ...record, ...next, status: 'draft', updatedAt: timestamp(now), review: null, disposition: null,
    history: addEvent(record, 'updated', now, '', 'Изменено; требуется подтверждение человеком'),
  };
}
export function transitionFinding(record, target, { actor = '', note = '', now = new Date().toISOString() } = {}) {
  const allowed = { draft: ['confirmed', 'dismissed'], confirmed: ['resolved', 'dismissed', 'draft'], resolved: ['draft'], dismissed: ['draft'] };
  requireThat(allowed[record.status]?.includes(target), 'Этот переход статуса недоступен.');
  actor = text(actor, 'Проверяющий', 160);
  note = text(note, 'Комментарий', 2000, target === 'confirmed');
  let review = record.review;
  let disposition = record.disposition;
  if (target === 'confirmed') {
    const gaps = evidenceGaps(record);
    requireThat(gaps.length === 0, `Для подтверждения заполните: ${gaps.join(', ')}.`);
    review = { by: actor, at: timestamp(now), note };
  }
  if (target === 'resolved' || target === 'dismissed') disposition = { by: actor, at: timestamp(now), note };
  if (target === 'draft') { review = null; disposition = null; }
  return {
    ...record, status: target, updatedAt: timestamp(now), review, disposition,
    history: addEvent(record, target === 'draft' ? 'reopened' : target, now, actor, note),
  };
}
function reviewValue(value, required) {
  if (value == null) { requireThat(!required, 'В записи отсутствует подтверждение человека.'); return null; }
  requireThat(value && typeof value === 'object', 'Некорректное подтверждение.');
  return { by: text(value.by, 'Проверяющий', 160), at: timestamp(value.at), note: text(value.note ?? '', 'Комментарий', 2000, true) };
}
export function parseRegistry(raw) {
  requireThat(typeof raw === 'string' && raw.length <= 3_000_000, 'Размер JSON превышает 3 МБ.');
  let value;
  try { value = JSON.parse(raw); } catch { throw new RegistryError('Файл не является корректным JSON.'); }
  requireThat(value && value.schemaVersion === SCHEMA_VERSION, 'Неподдерживаемая версия реестра. Нужна schemaVersion: 1.');
  requireThat(Array.isArray(value.findings) && value.findings.length <= MAX_FINDINGS, `Реестр должен содержать не более ${MAX_FINDINGS} замечаний.`);
  const seen = new Set();
  const findings = value.findings.map(item => {
    const record = createFinding(item, { id: item?.id, now: timestamp(item?.createdAt) });
    requireThat(!seen.has(record.id), 'В файле повторяются идентификаторы замечаний.');
    seen.add(record.id);
    record.updatedAt = timestamp(item.updatedAt);
    record.status = oneOf(item.status, STATUSES, 'Статус');
    record.review = reviewValue(item.review, ['confirmed', 'resolved'].includes(record.status));
    record.disposition = reviewValue(item.disposition, ['resolved', 'dismissed'].includes(record.status));
    if (record.status === 'draft') requireThat(record.review === null && record.disposition === null, 'Черновик не должен содержать действующее подтверждение или решение о закрытии.');
    if (record.status === 'confirmed') requireThat(record.disposition === null, 'Подтверждённая открытая запись не должна содержать решение о закрытии.');
    if (record.status === 'resolved' || record.status === 'dismissed') requireThat(record.disposition.note.length > 0, 'Для закрытого замечания нужен комментарий.');
    if (['confirmed', 'resolved'].includes(record.status)) requireThat(evidenceGaps(record).length === 0, 'Подтверждённая запись содержит неполное доказательство.');
    requireThat(Array.isArray(item.history) && item.history.length > 0 && item.history.length <= 1000, 'Некорректная история записи.');
    record.history = item.history.map(event => ({
      type: oneOf(event.type, EVENTS, 'Событие'), at: timestamp(event.at),
      actor: text(event.actor ?? '', 'Автор события', 160, true), note: text(event.note ?? '', 'Комментарий события', 2000, true),
    }));
    return record;
  });
  return { schemaVersion: SCHEMA_VERSION, updatedAt: timestamp(value.updatedAt), findings };
}
export function replaceFinding(registry, finding, now = new Date().toISOString()) {
  const exists = registry.findings.some(f => f.id === finding.id);
  requireThat(exists || registry.findings.length < MAX_FINDINGS, `Достигнут лимит ${MAX_FINDINGS} замечаний.`);
  return { ...registry, updatedAt: timestamp(now), findings: exists ? registry.findings.map(f => f.id === finding.id ? finding : f) : [finding, ...registry.findings] };
}
export function saveRegistry(storage, registry) {
  const raw = JSON.stringify(registry);
  parseRegistry(raw);
  try { storage.setItem(STORAGE_KEY, raw); }
  catch { throw new RegistryError('Браузер не смог сохранить реестр. Изменения не применены. Экспортируйте данные и проверьте доступное место.'); }
}
export function importRegistry(storage, current, incoming) {
  const validated = parseRegistry(JSON.stringify(incoming));
  try { storage.setItem(BACKUP_KEY, JSON.stringify(current)); }
  catch { throw new RegistryError('Не удалось создать резервную копию. Импорт отменён; текущие данные сохранены.'); }
  saveRegistry(storage, validated);
  return validated;
}
export function filterFindings(findings, { search = '', pipeline = '', status = '', severity = '' } = {}) {
  const term = search.trim().toLocaleLowerCase('ru');
  return findings.filter(f => (!pipeline || f.pipeline === pipeline) && (!status || f.status === status) && (!severity || f.severity === severity) && (!term || [f.title, f.project, f.sourceFile, f.owner, f.id].some(s => s.toLocaleLowerCase('ru').includes(term))));
}
