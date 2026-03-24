# Changelog

## [0.5.0](https://github.com/bis-code/study-dash/compare/study-dash-v0.4.1...study-dash-v0.5.0) (2026-03-24)


### Features

* **dashboard:** add exercise editor HTML and CSS ([9112ac2](https://github.com/bis-code/study-dash/commit/9112ac2b563e78d07f8e059f7996aef126df7204))
* **dashboard:** add exercise editor with CodeMirror 6 and test runner ([5b08b4e](https://github.com/bis-code/study-dash/commit/5b08b4eedf530029812595fd7059f4501a614701))
* **dashboard:** add exercise files API endpoints and startup migration ([70391fd](https://github.com/bis-code/study-dash/commit/70391fd840a0a136c9b319b72660da92965fbec8))
* **exercises:** add file read/save methods and .txt migration ([63c9741](https://github.com/bis-code/study-dash/commit/63c9741cb11fe8788fcc962ba61673256a0a2f64))


### Bug Fixes

* **exercises:** normalize language to lowercase for file extensions and test runners ([59a83a4](https://github.com/bis-code/study-dash/commit/59a83a4240753fa5cde4aeee509cd08fc136fa5a))

## [0.4.1](https://github.com/bis-code/study-dash/compare/study-dash-v0.4.0...study-dash-v0.4.1) (2026-03-24)


### Bug Fixes

* **ci:** grant contents:write permission for bundle commit ([a7e4373](https://github.com/bis-code/study-dash/commit/a7e43733073bd195e658911a466c6d37faf6aa88))
* **ci:** grant contents:write permission for bundle commit ([d3a0795](https://github.com/bis-code/study-dash/commit/d3a0795c2c11e32ecd20d1a76c700f2802277153))
* **ci:** replace bundle auto-commit with validation check ([8fcbd41](https://github.com/bis-code/study-dash/commit/8fcbd415c25d0836e69113e2ff7919898e44d40c))
* **plugin:** auto-install native deps on first session ([a55c5ba](https://github.com/bis-code/study-dash/commit/a55c5bad9d9ebf37b38f186cd124b9bd8d52e4e5))

## [0.4.0](https://github.com/bis-code/study-dash/compare/study-dash-v0.3.1...study-dash-v0.4.0) (2026-03-24)


### Features

* **dashboard:** add PDF file proxy endpoint ([50be253](https://github.com/bis-code/study-dash/commit/50be25340745797e11e29fb88485efee3552958e))
* **dashboard:** inline PDF viewer with lazy-loading ([2001c76](https://github.com/bis-code/study-dash/commit/2001c761b5aeb4684cd5e9864ef62acefd0258be))

## [0.3.1](https://github.com/bis-code/study-dash/compare/study-dash-v0.3.0...study-dash-v0.3.1) (2026-03-24)


### Bug Fixes

* **bundle:** switch from esbuild to rollup for zod 3.25 compatibility ([ab7a57d](https://github.com/bis-code/study-dash/commit/ab7a57d1ad3e7129428125b0777c5d88ed265c69))

## [0.3.0](https://github.com/bis-code/study-dash/compare/study-dash-v0.2.2...study-dash-v0.3.0) (2026-03-23)


### Features

* **dashboard:** resource cards styling + exercise expand/chevron UX ([69ee400](https://github.com/bis-code/study-dash/commit/69ee400a537e78451cd89cb5e10ac103016c7470))
* **resources:** add MCP tools, API endpoint, and dashboard routing ([9cfdf23](https://github.com/bis-code/study-dash/commit/9cfdf232e4405b38202117b5643bf5e38eae3611))
* **resources:** add ResourceService with CRUD and bulk import ([7976221](https://github.com/bis-code/study-dash/commit/7976221e5b54ac74d829d7870f15e39793469dd5))
* **resources:** render clickable resource links in Resources tab ([cd02cd4](https://github.com/bis-code/study-dash/commit/cd02cd4bfcef9a9c120253683740e783de2c2633))
* **schema:** add resources table for per-topic reference links ([0c9f362](https://github.com/bis-code/study-dash/commit/0c9f362d6f67f494e7d7514fc09e49b6d5111c20))


### Bug Fixes

* **ci:** handle no-op bundle commit gracefully ([1c3049a](https://github.com/bis-code/study-dash/commit/1c3049a4d4c1b706f4019e8648c771edda3430bc))

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
