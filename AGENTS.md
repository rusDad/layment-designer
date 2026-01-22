# Конструктор ложементов — Agent Rules (Codex)

## Цель проекта
Web-конструктор раскладки инструментов в габаритах ложемента (EVA-foam) + детерминированная генерация G-code для ЧПУ.

## Жёсткие инварианты (не ломать)
- Frontend "тупой", Backend "умный": все производственные преобразования и G-code — только на backend.
- Единицы: 1 px == 1 mm всегда. Никаких скрытых пересчётов и "удобных" масштабов.
- Стабильные идентификаторы важнее удобства: `id` FS-safe, создаётся один раз и используется в файлах/JSON/G-code.
- Domain — единственный источник истины по каталогу: `domain/contours/manifest.json` + папки `svg/`, `nc/`, `preview/`.
- В `manifest.assets.*` хранятся ОТНОСИТЕЛЬНЫЕ пути БЕЗ ведущего `/`:
  - `svg/<id>.svg`, `nc/<id>.nc`, `preview/<id>.<ext>`
- Координаты для контура на фронте: использовать `obj.aCoords.tl` (top-left bbox) — это осознанная семантика.
- Все проверки/экспорт на фронте выполняются при scale=1 (паттерн `performWithScaleOne()`).
- Manifest нельзя получать как статик (/contours/manifest.json закрыт nginx).Использовать только GET /api/contours/manifest.

“prod routing: /api/*, /admin/api/*, /contours/*”
“на проде есть systemd unit layment-backend.service и nginx site layment-designer”
(детали ExecStart/alias — в DEPLOYMENT.md) 

## URL-неймспейсы (канон)
- Public API: `/api/*`
- Admin API: `/admin/api/*`
- Admin UI: `/admin` (static)
- Domain static: `/contours/*` (раздача `domain/contours`)

## Контракт export (frontend -> backend) — стабилен
Request JSON:
{
  "orderMeta": { "width": mm, "height": mm, "units": "mm", "coordinateSystem": "...", ... },
  "contours": [ { "id": str, "x": mm, "y": mm, "angle": deg, "scaleOverride": number } ],
  "primitives": [ ... ]
}

Backend обязан читать `orderMeta.width/height`, а не ширину/высоту на верхнем уровне.

## Ограничения по технологиям
- Не добавлять новые фреймворки (frontend остаётся plain JS + fabric.js; backend остаётся FastAPI).
- Не делать "красивый" рефакторинг ради рефакторинга. Только прозрачные инженерные изменения.
- Любая смена контракта/путей — синхронно на обеих сторонах + обновить docs.

## Критерии готовности изменений
- /api/export-layment работает, фронт и бэк согласованы.
- Админка пишет manifest assets в каноничном формате (без ведущего `/`).
- Backend использует абсолютную базу `BASE_DIR/domain/contours`, не зависит от cwd.
- Есть минимальный smoke-test (curl или ручной сценарий) и он описан в PR/коммите.

## Стиль работы агента
- Делай изменения небольшими и атомарными.
- Перед правками — найди все места использования (ripgrep).
- После — покажи дифф и список команд для проверки.
