/* --------------------
 * yauzl-promise module
 * Promisify yauzl
 * ------------------*/

'use strict';

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
		{ZipFile} = yauzl,
		cbArg = optionsArg + 1;

	yauzl[fnName] = function() {
		return new Promise((resolve, reject) => {
			const args = Array.prototype.slice.call(arguments);
			args[optionsArg] = Object.assign({}, args[optionsArg], {lazyEntries: true, autoClose: false});

			args[cbArg] = (err, zipFile) => {
				if (err) return reject(err);
				opened(zipFile, resolve, ZipFile);
			};

			original.apply(this, args);
		});
	};
}

function opened(zipFile, resolve, ZipFile) {
	// Convert to instance of ZipFile subclass
	if (!(zipFile instanceof ZipFile)) {
		const zipFileInternal = zipFile;
		zipFile = setPrototype(zipFile, ZipFile.prototype);

		// Forward events from internal ZipFile to exposed one
		zipFileInternal.on('close', () => zipFile.emit('close'));
		zipFileInternal.on('error', err => zipFile.emit('error', err));

		// Remove event interceptors from internal ZipFile
		// so `close` + `error` events fire on exposed zipFile instance
		// NB `._interceptors` already copied to subclass instance above
		if (zipFile._interceptors) zipFileInternal._interceptors = {};
	}

	// Init
	zipFile._reading = false;
	zipFile._closing = false;
	zipFile._resolver = undefined;
	zipFile._error = undefined;

	// Intercept events
	zipFile.intercept('entry', emittedEntry);
	zipFile.intercept('end', emittedEnd);
	zipFile.intercept('close', emittedClose);
	zipFile.intercept('error', emittedError);

	// Resolve promise with zip object
	resolve(zipFile);
}

/*
 * Error event handler
 */
function emittedError(err) {
	// jshint validthis:true
	// If operation in progress, reject its promise
	if (this._reading || this._closing) {
		this._reading = false;
		this._closing = false;
		const {reject} = this._resolver;
		this._resolver = undefined;
		return reject(err);
	}

	// Store error to be returned on next call to
	// `.readEntry()`, `.close()` or `.openReadStream()`.
	if (!this._error) this._error = err;
}

function rejectWithStoredError(zipFile, reject) {
	const err = zipFile._error;
	zipFile._error = undefined;
	reject(err);
}

/*
 * Promisify ZipFile `close` method
 */
function promisifyClose(ZipFile, Promise) {
	const close = ZipFile.prototype.close;

	ZipFile.prototype.close = function() {
		return new Promise((resolve, reject) => {
			if (this._error) return rejectWithStoredError(this, reject);
			if (!this.isOpen) return resolve();
			if (this._reading) return reject(new Error('Previous read has not completed yet'));
			// NB No need to check for `_closing` as `isOpen` check above
			// will prevent close being called twice

			this._closing = true;
			this._resolver = {resolve, reject};
			close.call(this);
		});
	};
}

function emittedClose() {
	// jshint validthis:true
	// If not closing, emit error
	if (!this._closing) return this.emit('error', new Error('Unexpected \'close\' event emitted'));

	// Unset closing flag
	this._closing = false;

	// Extract resolver
	const {resolve} = this._resolver;
	this._resolver = undefined;

	// Resolve promise
	resolve();
}

/*
 * Promisify ZipFile `readEntry` method
 */
function promisifyReadEntry(ZipFile, Promise) {
	const readEntry = ZipFile.prototype.readEntry;

	ZipFile.prototype.readEntry = function() {
		return new Promise((resolve, reject) => {
			if (this._error) return rejectWithStoredError(this, reject);
			if (!this.isOpen) return reject(new Error('ZipFile is not open'));
			if (this._reading) return reject(new Error('Previous read has not completed yet'));
			// NB No need to check for `_closing` as `isOpen` check above
			// will catch this case

			this._reading = true;
			this._resolver = {resolve, reject};
			readEntry.call(this);
		});
	};
}

function emittedEntry(entry) {
	// jshint validthis:true
	// If not reading, emit error
	if (!this._reading) return this.emit('error', new Error(`Unexpected '${entry ? 'entry' : 'end'}' event emitted`));

	// Unset reading flag
	this._reading = false;

	// Modify entry object
	if (entry) {
		// Convert to instance of Entry subclass
		const {Entry} = this.constructor;
		if (!(entry instanceof Entry)) entry = setPrototype(entry, Entry.prototype);

		// Set reference to zipFile on entry (used by `entry.openReadStream()`)
		entry.zipFile = this;
	}

	// Extract resolver
	const {resolve} = this._resolver;
	this._resolver = undefined;

	// Resolve promise with entry
	resolve(entry);
}

function emittedEnd() {
	// jshint validthis:true
	emittedEntry.call(this, null);
}

/*
 * Read all ZipFile entries
 * Reads all entries and returns a promise which resolves with an array of entries
 * `options.max` limits number returned (default 100)
 * `options.max` can be set to `0` for no limit
 */
function readEntries(numEntries) {
	// jshint validthis:true
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
			if (this._error) return rejectWithStoredError(this, reject);
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
	// jshint validthis:true
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
