# Changelog

## 4.0.0

Breaking changes:

* Reimplement yauzl from scratch (various API changes)

Features:

* Validation of CRC32 checksums
* Support Mac OS Archive Utility ZIPs

## 3.0.0

Breaking changes:

* Drop support for NodeJS < v16
* Remove handling no native `Promise` constructor

Features:

* Async iteration

Refactor:

* Add entry point in package root

Dependencies:

* Update dependencies

Tests:

* Run tests with Jest
* Test correct data from streams
* Capture stream errors [fix]
* Move test ZIP into `fixtures` dir

Docs:

* Improve simple use example
* Document `use` method
* Reformat docs + tweaks
* Add section on versioning
* Remove old badges from README
* Reverse order of changelog
* Update license year
* Remove license indentation

Dev:

* Replace JSHint with ESLint
* Use Github Actions for CI
* Update dev dependencies
* Add `package-lock.json`
* Replace `.npmignore` with `files` key in `package.json`
* Update editorconfig
* `.gitattributes` file
* Re-order `.gitignore`

## 2.1.3

* Update `yauzl-clone` dependency
* Fix changelog typo
* Run Travis CI tests on Node v10
* Update dev dependencies

## 2.1.2

* Update `yauzl-clone` dependency

## 2.1.1

* Update `yauzl-clone` dependency
* README update

## 2.1.0

* Use `yauzl-clone` module for cloning yauzl object
* Fix: Add `fd-slicer` dev dependency

## 2.0.1

* `.close` method works for zip files from `.fromBuffer`
* Tests for all access methods
* Lint: Tests indentation

## 2.0.0

* `useYauzl` clones yauzl object provided
* `useYauzl` clone option
* `ZipFile` + `Entry` subclass originals
* Use events-intercept module for capturing events
* Store state in symbol attributes
* Refactor: `opened` function
* Tests for `.usePromise` + `.useYauzl`

## 1.1.1

* Fix: No crash on unexpected errors/events from reader
* Fix: Do not clone ZipFile or Entry if not required
* Fix: Typos in error messages
* Do not copy event emitter properties to `ZipFile` instances
* Refactor: Only use jshint `validthis` in functions that need it

## 1.1.0

* Promisify `.close` method
* `.readEntries` + `.walkEntries` avoid creating long promise chains (closes #2)
* `.walkEntries` awaits promise from callback (closes #1)
* `ZipFile` is not event emitter (closes #3)
* Test for `.open` returning rejected promise if IO error
* Update `mocha` dev dependency

## 1.0.0

* Initial release
