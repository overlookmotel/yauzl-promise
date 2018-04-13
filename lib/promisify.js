/* --------------------
 * yauzl-promise module
 * Promisify yauzl
 * ------------------*/

'use strict';
// jshint -W040

// Exports
module.exports = (yauzl, Promise) => {
	const {ZipFile, Entry} = yauzl;

	// Promisify open + from... methods
	promisifyMethod(yauzl, Promise, 'open', 1);
	promisifyMethod(yauzl, Promise, 'fromFd', 1);
	promisifyMethod(yauzl, Promise, 'fromBuffer', 1);
	promisifyMethod(yauzl, Promise, 'fromRandomAccessReader', 2);

	// Promisify `close` method
	promisifyClose(ZipFile, Promise);

	// Promisify ZipFile `readEntry` method
	promisifyReadEntry(ZipFile, Promise);

	// Add ZipFile `emit` method
	ZipFile.prototype.emit = emit;

	// Add ZipFile `readEntries` + `walkEntries` methods
	ZipFile.prototype.readEntries = readEntries;
	addWalkEntriesMethod(ZipFile, Promise);

	// Promisify ZipFile `openReadStream` method
	promisifyOpenReadStream(ZipFile, Promise);

	// Add Entry `openReadStream` method
	Entry.prototype.openReadStream = entryOpenReadStream;

	// Add reference to Entry to ZipFile (used by `readEntries`)
	ZipFile.Entry = Entry;
};

/*
 * Promisify open/from... method
 */
function promisifyMethod(yauzl, Promise, fnName, optionsArg) {
	const original = yauzl[fnName],
		ZipFileProto = yauzl.ZipFile.prototype,
		cbArg = optionsArg + 1;

	yauzl[fnName] = function() {
		return new Promise((resolve, reject) => {
			const args = Array.prototype.slice.call(arguments);
			args[optionsArg] = Object.assign({}, args[optionsArg], {lazyEntries: true, autoClose: false});

			args[cbArg] = (err, _zipFile) => {
				if (err) return reject(err);

				// Convert to instance of modified ZipFile class
				// and store reference to original zipFile
				const zipFile = Object.create(ZipFileProto);
				zipFile._internal = _zipFile;

				for (let key in _zipFile) {
					if (_zipFile.hasOwnProperty(key) && ['domain', '_events', '_eventsCount', '_maxListeners'].indexOf(key) == -1) zipFile[key] = _zipFile[key];
				}

				// Init
				zipFile._reading = false;
				zipFile._resolver = undefined;

				resolve(zipFile);
			};

			original.apply(this, args);
		});
	};
}

/*
 * Promisify ZipFile `close` method
 */
function promisifyClose(ZipFile, Promise) {
	const close = ZipFile.prototype.close;

	ZipFile.prototype.close = function() {
		return new Promise((resolve, reject) => {
			if (!this.isOpen) return resolve();

			const internal = this._internal;

			function onClose() {
				removeListeners();
				resolve();
			}

			function onError(err) {
				removeListeners();
				reject(err);
			}

			function removeListeners() {
				internal.removeListener('close', onClose);
				internal.removeListener('error', onError);
			}

			internal.on('close', onClose);
			internal.on('error', onError);

			close.call(this);
		});
	};
}

/*
 * Promisify ZipFile `readEntry` method
 */
function promisifyReadEntry(ZipFile, Promise) {
	const readEntry = ZipFile.prototype.readEntry;

	ZipFile.prototype.readEntry = function() {
		return new Promise((resolve, reject) => {
			if (this._reading) return reject(new Error('Previous read has not completed yet'));
			this._reading = true;
			this._resolver = {resolve, reject};
			readEntry.call(this);
		});
	};
}

/*
 * Replacement `emit` method
 * Captures calls to `zipFile.emit()` from inside yauzl's `._readEntry()` method
 * and uses them to resolve/reject promise being returned by `.readEntry()`.
 */
function emit(event, value) {
	// If emit called when not reading, throw error
	if (!this._reading) throw new Error(`Unexpected event '${event} emitted'`);

	// Unset reading flag
	this._reading = false;

	// Get resolve + reject handlers
	const {resolve, reject} = this._resolver;
	this._resolver = undefined;

	if (event == 'entry') {
		// Convert to instance of modified Entry class
		const entry = setPrototype(value, this.constructor.Entry.prototype);

		// Set reference to zipFile on entry (used by `entry.openReadStream()`)
		entry.zipFile = this;

		resolve(entry);
	} else if (event == 'end') {
		resolve(null);
	} else if (event == 'error') {
		reject(value);
	} else {
		reject(new Error(`Unexpected event '${event} emitted'`));
	}
}

/*
 * Read all ZipFile entries
 * Reads all entries and returns a promise which resolves with an array of entries
 * `options.max` limits number returned (default 100)
 * `options.max` can be set to `0` for no limit
 */
function readEntries(numEntries) {
	const entries = [];
	return this.walkEntries(entry => {
		entries.push(entry);
	}, numEntries).then(() => {
		return entries;
	});
}

/*
 * Walk all ZipFile entries
 * Walks through each entry and calls `fn` with each.
 * Returns a promise which resolves when all have been read.
 */
function addWalkEntriesMethod(ZipFile, Promise) {
	ZipFile.prototype.walkEntries = function(callback, numEntries) {
		callback = wrapFunctionToReturnPromise(callback, Promise);

		return new Promise((resolve, reject) => {
			walkNextEntry(this, callback, numEntries, 0, err => {
				if (err) return reject(err);
				resolve();
			});
		});
	};
}

function walkNextEntry(zipFile, fn, numEntries, count, cb) {
	if (numEntries && count == numEntries) return cb();

	zipFile.readEntry().then(entry => {
		if (!entry) return cb();

		return fn(entry).then(() => {
			walkNextEntry(zipFile, fn, numEntries, count + 1, cb);
		});
	}).catch(err => {
		cb(err);
	});
}

/*
 * Promisify ZipFile `openReadStream` method
 */
function promisifyOpenReadStream(ZipFile, Promise) {
	const openReadStream = ZipFile.prototype.openReadStream;
	ZipFile.prototype.openReadStream = function(entry, options) {
		return new Promise((resolve, reject) => {
			openReadStream.call(this, entry, options || {}, (err, stream) => {
				if (err) return reject(err);
				resolve(stream);
			});
		});
	};
}

/*
 * Entry `openReadStream` method
 */
function entryOpenReadStream(options) {
	return this.zipFile.openReadStream(this, options);
}

/*
 * Utility functions
 */
function setPrototype(obj, proto) {
	return Object.assign(Object.create(proto), obj);
}

function wrapFunctionToReturnPromise(fn, Promise) {
	return function() {
		try {
			const result = fn.apply(this, arguments);
			if (result instanceof Promise) return result;
			return Promise.resolve(result);
		} catch (err) {
			return new Promise((resolve, reject) => { // jshint ignore:line
				reject(err);
			});
		}
	};
}
