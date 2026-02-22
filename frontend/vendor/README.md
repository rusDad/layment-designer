# Fabric vendor file

В этой директории хранится локальная, пропатченная копия Fabric.js, чтобы не зависеть от CDN и убрать предупреждение Canvas API:

- исходник берётся с CDNJS;
- патч: `alphabetical` -> `alphabetic`;
- итоговый файл: `fabric-<version>.patched.min.js`.

Обновление версии:

```bash
./scripts/update_fabric_vendor.sh 5.3.0
```

Если версия не передана, по умолчанию используется `5.3.0`.
