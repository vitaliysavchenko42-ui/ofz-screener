# ОФЗ-скринер и калькулятор

Таблица всех рублёвых ОФЗ Мосбирже с живыми ценами, доходностями и калькулятором покупки после налогов.

- ТЗ: [ТЗ.md](ТЗ.md)
- Данные: открытый ISS API Мосбиржи, обновление при каждом открытии страницы.
- Деплой: GitHub Pages, ссылка https://vitaliysavchenko42-ui.github.io/ofz-screener/ (зеркало — GitLab Pages https://savchenko-group.gitlab.io/savchenko-project/)

## Структура
```
site/          — страница (HTML/CSS/JS, без сборки)
  js/app.js        — загрузка данных Мосбиржи, таблица, фильтры
  js/calculator.js — чистые функции расчётов (доходности, налоги)
tests/         — проверка формул расчёта (python, запускается в CI)
.github/workflows/pages.yml — GitHub Actions: тесты + публикация Pages
.gitlab-ci.yml — GitLab CI: тесты + публикация Pages
```

## Локальная разработка
Просто открыть `site/index.html` или: `python -m http.server -d site 8000`.

## Запуск тестов
```
python -m unittest discover -s tests -v
```

Дисклеймер: сервис информационный, не является инвестиционной рекомендацией.
