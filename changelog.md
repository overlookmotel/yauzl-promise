# Changelog

## 1.0.0

* Initial release

## Next

* Promisify `.close` method
* `.readEntries` + `.walkEntries` avoid creating long promise chains (closes #2)
* `.walkEntries` awaits promise from callback (closes #1)
* `ZipFile` is not event emitter (closes #3)
* Test for `.open` returning rejected promise if IO error
* Update `mocha` dev dependency
