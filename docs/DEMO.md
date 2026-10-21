# Помещение 706: от замечания до проверяемой истории

Ориентир для первого знакомства — около двух минут; время человека не измерено. Здесь проверяется ручной процесс реестра на вымышленных данных. Это не отдельный реестр помещений, не анализ реального плана и не инженерная приёмка.

Запустите сайт по [README](../README.md#попробовать-за-несколько-шагов) и откройте `/propmind-design/evidence/`. Лучше использовать отдельный профиль браузера без рабочего реестра: все экземпляры пилота на одном origin используют общее localStorage. Перед экспериментом с существующим реестром экспортируйте JSON.

## Сценарий / Walkthrough

Нажмите **+ Новое замечание** / **New finding**. Заполните поля:

| Поле UI / Control | Учебное значение / Synthetic value |
|---|---|
| Замечание / Finding | [ДЕМО] Помещение 706 — не указано назначение |
| Объект / Project | [ДЕМО] Офисный корпус, этаж 7 |
| Контур / Pipeline | PDF Scan |
| Критичность / Severity | Средняя / Medium |
| Ответственный / Owner | [ДЕМО] Координатор проекта |
| Исходный файл / Source file | DEMO_FLOOR_7_R01.pdf |
| Ревизия / Revision | Учебная R01 |
| Исходный фрагмент / Evidence excerpt | Вымышленный пример: у помещения 706 не заполнено назначение. Учебная координатная область; исходный PDF не поставляется. |
| Страница / Page | 1 |
| X / Y, % | 20 / 30 |
| Ширина / Высота, % / Width / Height | 15 / 10 |

1. Нажмите **Сохранить замечание** / **Save finding**. Откройте созданную запись: статус **Черновик** / **Draft**.
2. В **Кто проверяет** / **Reviewer** укажите `[ДЕМО] Проверяющий`; комментарий — `Учебная проверка интерфейса, без приёмки документации`. Нажмите **Подтвердить** / **Confirm**. Статус станет **Подтверждено** / **Confirmed**.
3. Нажмите **Редактировать** / **Edit**, замените ревизию на `Учебная R02` и сохраните. Статус вернётся в черновик; прежнее решение останется в **Истории изменений** / **History**.
4. Закройте карточку и нажмите **Экспорт JSON** / **Export JSON**. В файле должны сохраниться `sourceFile`, `revision`, `excerpt`, `location` и `history`. Текущее `review` сбрасывается после содержательного изменения; прежнее подтверждение проверяется по событию `confirmed` в истории.

Путь показывает, как избежать сохранения старого подтверждения после смены документа. Проверяющий здесь вводится вручную, без подтверждения личности; это демонстрация поведения интерфейса.

## English notes

Run the local server described in the README and use a fresh browser profile. The table gives all values for a synthetic finding about room 706. The PDF filename and coordinates are illustrative; no source PDF is supplied.

Create the finding, save it, enter the demo reviewer and confirm. Change revision R01 to R02: the finding must return to draft, and the earlier confirmation must remain in history. Export JSON and inspect the source, revision, coordinates and history. Current review data is cleared after a meaningful edit; the old review remains as a history event.

This is a manual review workflow with local browser storage. There is no automatic PDF/IFC parsing, regulatory assessment, verified reviewer identity or shared server. The exercise does not establish production readiness or measured time savings.

## Воспроизвести запись интерфейса / Reproduce the capture

Для разработчика: `npm ci --ignore-scripts`, затем `npx --no-install playwright install chromium`. После запуска локального сервера выполните:

```bash
node scripts/showcase-room.mjs
```

Скрипт создаёт только синтетические записи в отдельном браузерном контексте; проходит desktop 1280 px и mobile 390 px, проверяет экспорт и историю. Он сохраняет PNG-кадры и JSON в игнорируемый `artifacts/showcase/`. Значения в кадрах должны совпадать с таблицей выше.

Анимация в README собрана из трёх desktop-кадров [успешного CI 39629128166](https://github.com/AlexNovikov77/propmind-design/actions/runs/39629128166), исходный SHA `8233a5f1cab495505e5eebef39391d67335d51b6`. Интервалы показа кадров сокращены; это не измерение скорости работы человека. Кадры не содержат реальных объектов или документов. Проверяемый сценарий и UI после съёмки не изменялись; позднейшие изменения этого PR относятся к документации и добавлению GIF.

[Архитектура данных](ARCHITECTURE.md) · [Как сообщить об ошибке](../CONTRIBUTING.md)
