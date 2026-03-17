# Admin UI rules
- см. ../../AGENTS.md
- В dev checkout параметризуем admin frontend через base prefix. ( const APP_BASE_PREFIX = window.location.pathname.startsWith('/dev/admin/') ? '/dev' : ''; )
- 
- DEV Admin API base: ${APP_BASE_PREFIX}/admin/api/*
- При создании/апдейте items строго следовать канону assets:
  svg/<id>.svg, nc/<id>.nc, preview/<id>.<ext>  (без ведущего "/")

