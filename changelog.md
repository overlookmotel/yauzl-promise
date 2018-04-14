# Changelog

## 1.0.0

* Initial release

## 1.1.0

* Promisify `.close` method
* `.readEntries` + `.walkEntries` avoid creating long promise chains (closes #2)
* `.walkEntries` awaits promise from callback (closes #1)
* `ZipFile` is not event emitter (closes #3)
* Test for `.open` returning rejected promise if IO error
* Update `mocha` dev dependency

## Next

* Fix: No crash on unexpected errors/events from reader
* Fix: Do not clone ZipFile or Entry if not required
* Fix: Typos in error messages
* Do not copy event emitter properties to `ZipFile` instances
* Refactor: Only use jshint `validthis` in functions that need it
