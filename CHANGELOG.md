# Changelog

## [0.2.2](https://github.com/bis-code/study-dash/compare/study-dash-v0.2.1...study-dash-v0.2.2) (2026-03-23)


### Bug Fixes

* commit bundle.mjs so plugin installs work from GitHub clone ([a41a6e8](https://github.com/bis-code/study-dash/commit/a41a6e8e344938e160598c05b0142ec0cda24add))

## [0.2.1](https://github.com/bis-code/study-dash/compare/study-dash-v0.2.0...study-dash-v0.2.1) (2026-03-23)


### Bug Fixes

* **dashboard:** inline static files via esbuild imports instead of readFileSync ([32c2f44](https://github.com/bis-code/study-dash/commit/32c2f44bc4fbc7f0a14d091afb194d7aa62045b0))

## [0.2.0](https://github.com/bis-code/study-dash/compare/study-dash-v0.1.0...study-dash-v0.2.0) (2026-03-22)


### Features

* add MCP entry point, HTTP server with REST API and SSE ([73d6707](https://github.com/bis-code/study-dash/commit/73d6707e8a4533f482cf79a08d269445eaa799e8))
* add shared TypeScript types ([d05230f](https://github.com/bis-code/study-dash/commit/d05230f4fd0bc6d34c68d72c03292b6f68532ac0))
* **curriculum:** add CurriculumService with CRUD, import, progress ([0ad1fc5](https://github.com/bis-code/study-dash/commit/0ad1fc55aad83f85dda461b846f7478e13a863b3))
* **dashboard:** add responsive dashboard with subject switching, tabs, SSE ([fc00cb5](https://github.com/bis-code/study-dash/commit/fc00cb5c8952b0a7e49ac4fa38a5024621c8d069))
* **exercises:** add ExerciseService with test runner, quiz scoring, MCP tools ([ad7ac40](https://github.com/bis-code/study-dash/commit/ad7ac40b682e5babb862796e80e8c8af230b93e8))
* **plugin:** add rules, skills, commands, and hooks ([4c4d2fe](https://github.com/bis-code/study-dash/commit/4c4d2fe5e921d069d825547a29c8c1b15102aa3e))
* **qa:** add QAService with logging, search, and MCP tools ([78a3fe9](https://github.com/bis-code/study-dash/commit/78a3fe976011bc5aa7c7ad14947b79a2c32021be))
* **storage:** add FileStore for exercise file I/O ([89667de](https://github.com/bis-code/study-dash/commit/89667de10c63791e5857f00fbc25205066fc5461))
* **storage:** add SQLite schema, migrations, and Database class ([0a567f1](https://github.com/bis-code/study-dash/commit/0a567f12cfd729e19eed5f1b730d146b259b8c99))
* **tools:** add 7 curriculum MCP tool handlers ([6566d57](https://github.com/bis-code/study-dash/commit/6566d577a2bef54390dbee8232723b07adaa2fac))
* **viz:** add VizService and MCP tools ([a02434a](https://github.com/bis-code/study-dash/commit/a02434a20d20f03343c4ec6235e6dd7a45c2ade7))


### Bug Fixes

* **qa:** fix search return type to match SQLite query output ([9736230](https://github.com/bis-code/study-dash/commit/9736230351bea16fcbabeedd7f68bdaab0ba6f6c))
