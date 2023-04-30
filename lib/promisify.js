/* --------------------
 * yauzl-promise module
 * Promisify yauzl
 * ------------------*/

'use strict';

// Modules
const cloner = require('yauzl-clone');

// Constants
const STATE = Symbol('yauzl-promise/STATE'),
	STORED_ERROR = Symbol('yauzl-promise/STORED_ERROR');

// Exports
module.exports = (yauzl, Promise) => {
	const {ZipFile, Entry} = yauzl;

	// Promisify open + from... methods
	promisifyMethod(yauzl, Promise, 'open');
	promisifyMethod(yauzl, Promise, 'fromFd');
	promisifyMethod(yauzl, Promise, 'fromBuffer');
	promisifyMethod(yauzl, Promise, 'fromRandomAccessReader');

	// Promisify `close` method
	promisifyClose(ZipFile, Promise);

	// Promisify ZipFile `readEntry` method
	promisifyReadEntry(ZipFile, Promise);

	// Add ZipFile `readEntries` + `walkEntries` methods
	ZipFile.prototype.readEntries = readEntries;
	addWalkEntriesMethod(ZipFile, Promise);

	// Add async iterator
	addAsyncIterator(ZipFile);

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
function promisifyMethod(yauzl, Promise, fnName) {
	const fromBuffer = fnName === 'fromBuffer';

	cloner.patch(yauzl, fnName, original => function(path, totalSize, options) {
		return new Promise((resolve, reject) => {
			options = {...options, lazyEntries: true, autoClose: false};

			original(path, totalSize, options, (err, zipFile) => {
				if (err) {
					reject(err);
				} else {
					opened(zipFile, resolve, fromBuffer, yauzl);
				}
			});
		});
	});
}

function opened(zipFile, resolve, fromBuffer, yauzl) {
	// For `.fromBuffer()` calls, adapt `reader` to emit close event
	if (fromBuffer) {
		zipFile.reader.unref = yauzl.RandomAccessReader.prototype.unref;
		zipFile.reader.close = cb => cb();
	}

	// Init
	clearState(zipFile);
	clearError(zipFile);

	// Intercept events
	zipFile.intercept('entry', emittedEntry);
	zipFile.intercept('end', emittedEnd);
	zipFile.intercept('close', emittedClose);
	zipFile.intercept('error', emittedError);

	// Resolve promise with zip object
	resolve(zipFile);
}

/**
 * Handle `error` event emitted by Yauzl.
 * @this ZipFile
 * @param {Error} err - Error
 * @returns {undefined}
 */
function emittedError(err) {
	// If operation in progress, reject its promise
	const state = getState(this);
	if (state) {
		clearState(this);
		state.reject(err);
		return;
	}

	// Store error to be returned on next call to
	// `.readEntry()`, `.close()` or `.openReadStream()`.
	if (!getError(this)) setError(this, err);
}

function rejectWithStoredError(zipFile, reject) {
	const err = getError(zipFile);
	clearError(zipFile);
	reject(err);
}

/*
 * Promisify ZipFile `close` method
 */
function promisifyClose(ZipFile, Promise) {
	const {close} = ZipFile.prototype;
	ZipFile.prototype.close = function() {
		return new Promise((resolve, reject) => {
			if (getError(this)) {
				rejectWithStoredError(this, reject);
			} else if (!this.isOpen) {
				resolve();
			} else if (getState(this)) {
				reject(new Error('Previous operation has not completed yet'));
			} else {
				setState(this, {action: 'close', resolve, reject});
				close.call(this);
			}
		});
	};
}

/**
 * Handle `close` event emitted by Yauzl.
 * @this ZipFile
 * @returns {undefined}
 */
function emittedClose() {
	// If not closing, emit error
	const state = getState(this);
	if (!state || state.action !== 'close') {
		this.emit('error', new Error('Unexpected \'close\' event emitted'));
		return;
	}

	clearState(this);

	// Resolve promise
	state.resolve();
}

/*
 * Promisify ZipFile `readEntry` method
 */
function promisifyReadEntry(ZipFile, Promise) {
	const {readEntry} = ZipFile.prototype;
	ZipFile.prototype.readEntry = function() {
		return new Promise((resolve, reject) => {
			if (getError(this)) {
				rejectWithStoredError(this, reject);
			} else if (!this.isOpen) {
				reject(new Error('ZipFile is not open'));
			} else if (getState(this)) {
				reject(new Error('Previous operation has not completed yet'));
			} else {
				setState(this, {action: 'read', resolve, reject});
				readEntry.call(this);
			}
		});
	};
}

/**
 * Handle `entry` event emitted by Yauzl.
 * @this ZipFile
 * @param {Object} entry - `Entry` object
 * @returns {undefined}
 */
function emittedEntry(entry) {
	// If not reading, emit error
	const state = getState(this);
	if (!state || state.action !== 'read') {
		this.emit('error', new Error(`Unexpected '${entry ? 'entry' : 'end'}' event emitted`));
		return;
	}

	clearState(this);

	// Set reference to zipFile on entry (used by `entry.openReadStream()`)
	if (entry) entry.zipFile = this;

	// Resolve promise with entry
	state.resolve(entry);
}

/**
 * Handle `end` event emitted by Yauzl.
 * @this ZipFile
 * @returns {undefined}
 */
function emittedEnd() {
	emittedEntry.call(this, null);
}

/*
 * Functions to access state
 */
function getState(zipFile) {
	return zipFile[STATE];
}

function setState(zipFile, state) {
	zipFile[STATE] = state;
}

function clearState(zipFile) {
	zipFile[STATE] = undefined;
}

function getError(zipFile) {
	return zipFile[STORED_ERROR];
}

function setError(zipFile, state) {
	zipFile[STORED_ERROR] = state;
}

function clearError(zipFile) {
	zipFile[STORED_ERROR] = undefined;
}

/**
 * Read all ZipFile entries.
 * Reads all entries and returns a promise which resolves with an array of entries.
 * `options.max` limits number returned (default 100)
 * `options.max` can be set to `0` for no limit
 *
 * @this ZipFile
 * @param {number} [numEntries] - Number of entries to return
 * @returns {Promise<Array>} - Promise of array of `Entry` objects
 */
function readEntries(numEntries) {
	const entries = [];
	return this.walkEntries((entry) => {
		entries.push(entry);
	}, numEntries).then(() => entries);
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
			walkNextEntry(this, callback, numEntries, 0, (err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	};
}

function walkNextEntry(zipFile, fn, numEntries, count, cb) {
	if (numEntries && count === numEntries) {
		cb();
		return;
	}

	zipFile.readEntry()
		.then((entry) => {
			if (!entry) {
				cb();
				return undefined;
			}
			return fn(entry).then(() => walkNextEntry(zipFile, fn, numEntries, count + 1, cb));
		})
		.catch(cb);
}

/**
 * Add async iterator to iterate over ZIP file's entries.
 * @param {Object} ZipFile - `ZipFile` class
 * @returns {undefined}
 */
function addAsyncIterator(ZipFile) {
	ZipFile.prototype[Symbol.asyncIterator] = function() {
		return {
			next: () => this.readEntry().then(entry => ({value: entry, done: entry === null}))
		};
	};
}

/*
 * Promisify ZipFile `openReadStream` method
 */
function promisifyOpenReadStream(ZipFile, Promise) {
	const {openReadStream} = ZipFile.prototype;
	ZipFile.prototype.openReadStream = function(entry, options) {
		return new Promise((resolve, reject) => {
			if (getError(this)) {
				rejectWithStoredError(this, reject);
				return;
			}

			openReadStream.call(this, entry, options || {}, (err, stream) => {
				if (err) {
					reject(err);
				} else {
					resolve(stream);
				}
			});
		});
	};
}

/**
 * Entry `openReadStream` method.
 * @this Entry
 * @param {Object} [options] - Options
 * @returns {Promise} - Promise of stream
 */
function entryOpenReadStream(options) {
	return this.zipFile.openReadStream(this, options);
}

/*
 * Utility functions
 */
function wrapFunctionToReturnPromise(fn, Promise) {
	return function(...args) {
		try {
			const result = fn.apply(this, args); // eslint-disable-line no-invalid-this
			if (result instanceof Promise) return result;
			return Promise.resolve(result);
		} catch (err) {
			return new Promise((resolve, reject) => {
				reject(err);
			});
		}
	};
}
