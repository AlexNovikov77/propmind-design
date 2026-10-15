import {
  STORAGE_KEY, BACKUP_KEY, emptyRegistry, createFinding, editFinding,
  transitionFinding, evidenceGaps, replaceFinding, parseRegistry,
  saveRegistry, importRegistry, filterFindings,
} from './registry.mjs';

const $ = id => document.getElementById(id);
const form = $('finding-form');
const severityLabels = { critical: 'Критическая', high: 'Высокая', medium: 'Средняя', low: 'Низкая' };
const statusLabels = { draft: 'Черновик', confirmed: 'Подтверждено', resolved: 'Устранено', dismissed: 'Отклонено' };
const eventLabels = { created: 'Создано', updated: 'Изменено', confirmed: 'Подтверждено', resolved: 'Устранено', dismissed: 'Отклонено', reopened: 'Возвращено на проверку' };
let state = emptyRegistry();
let storage;
let storedSnapshot = null;
let locked = false;
let editingId = null;
let selectedId = null;
let pendingImport = null;

function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function message(text, error = false) {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !text;
}
function formError(id, error) {
  $(id).textContent = error?.message || String(error || '');
  $(id).hidden = !error;
  if (error) $(id).scrollIntoView({ block: 'nearest' });
}
function date(value) { return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }
function current() { return state.findings.find(f => f.id === selectedId); }
function checkStorage() {
  if (locked || !storage) throw new Error('Сохранение недоступно. Сначала восстановите доступ к хранилищу браузера.');
  if (storage.getItem(STORAGE_KEY) !== storedSnapshot) throw new Error('Реестр изменён в другой вкладке. Обновите страницу перед сохранением, чтобы не затереть чужие изменения.');
}
function persist(next) {
  checkStorage();
  saveRegistry(storage, next);
  state = next;
  storedSnapshot = storage.getItem(STORAGE_KEY);
  render();
}
try {
  storage = window.localStorage;
  storedSnapshot = storage.getItem(STORAGE_KEY);
  if (storedSnapshot !== null) state = parseRegistry(storedSnapshot);
} catch (error) {
  locked = true;
  message(`Реестр не загружен: ${error.message} Запись заблокирована, исходные данные не изменены. Если JSON повреждён, сохраните его кнопкой «Экспорт JSON» перед восстановлением.`, true);
}

function locator(record) {
  const loc = record.location;
  const n = value => value === null ? '—' : String(value);
  if (record.pipeline === 'PDF Scan') return `Стр. ${n(loc.page)} · x ${n(loc.x)}%, y ${n(loc.y)}%, ${n(loc.width)} × ${n(loc.height)}%`;
  return `GlobalId: ${loc.globalId || '—'} · (${n(loc.x)}; ${n(loc.y)}; ${n(loc.z)}) м`;
}
function render() {
  const all = state.findings;
  $('total-count').textContent = all.length;
  $('draft-count').textContent = all.filter(f => f.status === 'draft').length;
  $('critical-count').textContent = all.filter(f => f.severity === 'critical' && ['draft', 'confirmed'].includes(f.status)).length;
  $('resolved-count').textContent = all.filter(f => f.status === 'resolved').length;
  const visible = filterFindings(all, {
    search: $('search').value, pipeline: $('pipeline-filter').value,
    status: $('status-filter').value, severity: $('severity-filter').value,
  });
  const body = $('findings-body');
  body.replaceChildren();
  for (const record of visible) {
    const row = el('tr');
    const titleCell = el('td');
    const open = el('button', record.title, 'link-button');
    open.type = 'button';
    open.addEventListener('click', () => showDetail(record.id));
    titleCell.append(open, el('span', record.project, 'sub'));
    const sourceCell = el('td', record.pipeline);
    sourceCell.append(el('span', record.sourceFile || 'Источник не указан', 'sub'), el('span', record.pipeline === 'PDF Scan' ? `Стр. ${record.location.page ?? '—'}` : record.location.globalId || 'GlobalId не указан', 'sub'));
    const severityCell = el('td');
    severityCell.append(el('span', severityLabels[record.severity], `badge severity-${record.severity}`));
    const statusCell = el('td');
    statusCell.append(el('span', statusLabels[record.status], `badge status-${record.status}`));
    row.append(titleCell, sourceCell, severityCell, statusCell, el('td', record.owner || 'Не назначен'));
    body.append(row);
  }
  $('table-wrap').hidden = visible.length === 0;
  $('empty').hidden = visible.length > 0;
  $('empty-title').textContent = all.length ? 'По этим фильтрам ничего не найдено' : 'Первое замечание — начало реестра';
  $('empty-description').textContent = all.length ? 'Измените поиск или фильтры. Все записи остаются в реестре.' : 'Создайте запись по PDF или IFC. Источник и координаты можно уточнить в черновике до подтверждения.';
  $('add-examples').hidden = all.length > 0;
  $('result-count').textContent = `Показано ${visible.length} из ${all.length}`;
  for (const id of ['add-finding', 'empty-add', 'add-examples', 'import-json']) $(id).disabled = locked;
  try { $('restore-backup').hidden = locked || !storage?.getItem(BACKUP_KEY); }
  catch { $('restore-backup').hidden = true; }
}
function resetFilters(pipeline = '') {
  $('search').value = '';
  $('pipeline-filter').value = pipeline;
  $('status-filter').value = '';
  $('severity-filter').value = '';
}
function updateLocationFields() {
  const pdf = form.elements.pipeline.value === 'PDF Scan';
  $('pdf-location').hidden = !pdf;
  $('pdf-location').disabled = !pdf;
  $('ifc-location').hidden = pdf;
  $('ifc-location').disabled = pdf;
}
function openForm(record = null) {
  editingId = record?.id ?? null;
  form.reset();
  formError('finding-error', null);
  $('finding-heading').textContent = record ? 'Редактировать замечание' : 'Новое замечание';
  if (record) {
    for (const key of ['title', 'project', 'pipeline', 'severity', 'owner', 'sourceFile', 'revision', 'excerpt']) form.elements[key].value = record[key];
    const loc = record.location;
    if (record.pipeline === 'PDF Scan') {
      for (const [field, key] of [['pdfPage', 'page'], ['pdfX', 'x'], ['pdfY', 'y'], ['pdfWidth', 'width'], ['pdfHeight', 'height']]) form.elements[field].value = loc[key] ?? '';
    } else {
      form.elements.ifcGlobalId.value = loc.globalId;
      for (const key of ['x', 'y', 'z']) form.elements[`ifc${key.toUpperCase()}`].value = loc[key] ?? '';
    }
  } else if ($('pipeline-filter').value) form.elements.pipeline.value = $('pipeline-filter').value;
  updateLocationFields();
  $('finding-dialog').showModal();
}
function inputValues() {
  const values = Object.fromEntries(new FormData(form));
  const get = key => form.elements[key].value;
  values.location = values.pipeline === 'PDF Scan'
    ? { page: get('pdfPage'), x: get('pdfX'), y: get('pdfY'), width: get('pdfWidth'), height: get('pdfHeight') }
    : { globalId: get('ifcGlobalId'), x: get('ifcX'), y: get('ifcY'), z: get('ifcZ') };
  return values;
}
form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const values = inputValues();
    const old = state.findings.find(f => f.id === editingId);
    const record = old ? editFinding(old, values) : createFinding(values, { id: `ER-${crypto.randomUUID()}` });
    const next = replaceFinding(state, record);
    checkStorage();
    saveRegistry(storage, next);
    state = next;
    storedSnapshot = storage.getItem(STORAGE_KEY);
    resetFilters(record.pipeline);
    render();
    $('finding-dialog').close();
    message(old && old.status !== record.status ? 'Изменения сохранены. Запись возвращена в черновик для повторного подтверждения.' : 'Замечание сохранено в этом браузере.');
  } catch (error) { formError('finding-error', error); }
});
form.elements.pipeline.addEventListener('change', updateLocationFields);

function showDetail(id) {
  selectedId = id;
  const record = current();
  if (!record) return;
  formError('detail-error', null);
  $('detail-title').textContent = record.title;
  const content = $('detail-content');
  content.replaceChildren(el('div', record.id, 'detail-id'));
  const badges = el('div', null, 'actions');
  badges.append(el('span', statusLabels[record.status], `badge status-${record.status}`), el('span', severityLabels[record.severity], `badge severity-${record.severity}`));
  content.append(badges);
  const details = el('dl', null, 'details-grid');
  for (const [name, value] of [
    ['Объект', record.project], ['Контур', record.pipeline], ['Ответственный', record.owner || 'Не назначен'],
    ['Исходный файл', record.sourceFile || 'Не указан'], ['Ревизия', record.revision || 'Не указана'],
    ['Привязка', locator(record)], ['Создано', date(record.createdAt)], ['Изменено', date(record.updatedAt)],
  ]) { const pair = el('div'); pair.append(el('dt', name), el('dd', value)); details.append(pair); }
  content.append(details, el('h3', 'Исходный фрагмент'), el('div', record.excerpt || 'Пока не добавлен', 'excerpt'));
  const gaps = evidenceGaps(record);
  if (record.status === 'draft' && gaps.length) content.append(el('p', `До подтверждения заполните: ${gaps.join(', ')}.`, 'form-hint'));
  if (record.review) content.append(el('p', `Проверил(а): ${record.review.by} · ${date(record.review.at)}${record.review.note ? ` · ${record.review.note}` : ''}`, 'review-info'));
  if (record.disposition) content.append(el('p', `Решение: ${record.disposition.by} · ${record.disposition.note}`, 'review-info'));
  $('reviewer').value = record.review?.by || '';
  $('review-note').value = '';
  const transitions = { draft: [['confirmed', 'Подтвердить'], ['dismissed', 'Отклонить']], confirmed: [['resolved', 'Отметить устранённым'], ['dismissed', 'Отклонить'], ['draft', 'Вернуть в черновик']], resolved: [['draft', 'Вернуть в черновик']], dismissed: [['draft', 'Вернуть в черновик']] };
  $('review-actions').replaceChildren();
  for (const [target, label] of transitions[record.status]) {
    const button = el('button', label, `button${target === 'confirmed' || target === 'resolved' ? ' primary' : ''}`);
    button.type = 'button';
    button.disabled = locked;
    button.addEventListener('click', () => {
      try {
        const nextRecord = transitionFinding(current(), target, { actor: $('reviewer').value, note: $('review-note').value });
        persist(replaceFinding(state, nextRecord));
        showDetail(id);
        message(`Статус изменён: ${statusLabels[target]}.`);
      } catch (error) { formError('detail-error', error); }
    });
    $('review-actions').append(button);
  }
  $('edit-finding').disabled = locked;
  $('history-list').replaceChildren();
  for (const event of [...record.history].reverse()) {
    const entry = el('li', `${eventLabels[event.type]}${event.actor ? ` · ${event.actor}` : ''}`);
    const time = el('time', date(event.at)); time.dateTime = event.at;
    entry.append(time, el('span', event.note, 'history-note'));
    $('history-list').append(entry);
  }
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
}
$('edit-finding').addEventListener('click', () => { const record = current(); $('detail-dialog').close(); openForm(record); });
$('add-finding').addEventListener('click', () => openForm());
$('empty-add').addEventListener('click', () => openForm());
for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => $(control.dataset.close).close());
for (const id of ['search', 'pipeline-filter', 'status-filter', 'severity-filter']) $(id).addEventListener('input', render);

function download(raw) {
  const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url; link.download = `propmind-evidence-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-json').addEventListener('click', () => download(locked && storedSnapshot !== null ? storedSnapshot : JSON.stringify(state, null, 2)));
function previewImport(incoming) {
  pendingImport = incoming;
  $('confirm-import').disabled = false;
  $('import-preview').replaceChildren(
    el('p', `Будет загружено замечаний: ${incoming.findings.length}. Дата реестра: ${date(incoming.updatedAt)}.`),
    el('p', `Текущих записей: ${state.findings.length}. Они будут заменены. Одна копия до импорта сохранится в этом браузере.`),
    el('p', 'Имена проверяющих и история из файла не подтверждают личность авторов; импортируйте данные из доверенного источника.'),
  );
}
$('import-json').addEventListener('click', () => {
  pendingImport = null;
  $('import-file').value = '';
  $('confirm-import').disabled = true;
  formError('import-error', null);
  $('import-preview').textContent = 'Импорт заменяет текущий реестр целиком. Перед заменой будет сохранена одна локальная копия; дополнительно экспортируйте JSON.';
  $('import-dialog').showModal();
});
$('import-file').addEventListener('change', async () => {
  pendingImport = null; $('confirm-import').disabled = true;
  formError('import-error', null);
  $('import-preview').textContent = '';
  const file = $('import-file').files[0];
  if (!file) return;
  try {
    if (file.size > 3_000_000) throw new Error('Размер JSON превышает 3 МБ.');
    const raw = await file.text();
    if ($('import-file').files[0] !== file) return;
    previewImport(parseRegistry(raw));
  } catch (error) { formError('import-error', error); }
});
$('confirm-import').addEventListener('click', () => {
  if (!pendingImport) return;
  try {
    checkStorage();
    state = importRegistry(storage, state, pendingImport);
    storedSnapshot = storage.getItem(STORAGE_KEY);
    resetFilters(); render();
    $('import-dialog').close();
    message('Реестр импортирован. Копию до замены можно вернуть кнопкой внизу страницы.');
    pendingImport = null;
  } catch (error) { formError('import-error', error); }
});
$('restore-backup').addEventListener('click', () => {
  try {
    const backup = parseRegistry(storage.getItem(BACKUP_KEY));
    $('import-json').click();
    previewImport(backup);
  } catch (error) { message(`Копия не восстановлена: ${error.message}`, true); }
});
$('add-examples').addEventListener('click', () => {
  try {
    let next = state;
    for (const input of [
      { title: '[ДЕМО] Не указана марка противопожарного клапана', project: '[ДЕМО] Офисный объект', pipeline: 'PDF Scan', severity: 'high', owner: 'Инженер ОВ', sourceFile: 'DEMO_OV_R01.pdf', revision: 'Учебная R01', excerpt: 'Учебный пример: на плане обозначен клапан К1, в спецификации его марка не заполнена. Это не результат проверки реальной документации.', location: { page: 12, x: 24, y: 38, width: 18, height: 10 } },
      { title: '[ДЕМО] Не заполнен серийный номер оборудования', project: '[ДЕМО] Офисный объект', pipeline: 'IFC Deep Check', severity: 'medium', owner: 'BIM-координатор', sourceFile: 'DEMO_MEP_R01.ifc', revision: 'Учебная R01', excerpt: 'Учебный пример: свойство SerialNumber отсутствует у выбранного оборудования. Это не результат автоматической проверки модели.', location: { globalId: 'DEMO-EQUIPMENT-001', x: 12.5, y: 8.2, z: 3.6 } },
    ]) next = replaceFinding(next, createFinding(input, { id: `ER-${crypto.randomUUID()}` }));
    checkStorage(); saveRegistry(storage, next);
    state = next; storedSnapshot = storage.getItem(STORAGE_KEY);
    resetFilters(); render(); message('Добавлены два учебных примера. Это вымышленные записи, их можно отклонить с комментарием.');
  } catch (error) { message(error.message, true); }
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY && event.newValue !== storedSnapshot) message('Реестр изменён в другой вкладке. Обновите страницу перед редактированием.', true);
});
const selectedPipeline = new URLSearchParams(location.search).get('pipeline');
if (selectedPipeline === 'pdf') $('pipeline-filter').value = 'PDF Scan';
if (selectedPipeline === 'ifc') $('pipeline-filter').value = 'IFC Deep Check';
render();
