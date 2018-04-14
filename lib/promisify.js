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
		{ZipFile} = yauzl,
		ZipFileProto = ZipFile.prototype,
		cbArg = optionsArg + 1;

	yauzl[fnName] = function() {
		return new Promise((resolve, reject) => {
			const args = Array.prototype.slice.call(arguments);
			args[optionsArg] = Object.assign({}, args[optionsArg], {lazyEntries: true, autoClose: false});

			args[cbArg] = (err, zipFile) => {
				if (err) return reject(err);

				// Convert to instance of modified ZipFile class
				// and store reference to original zipFile
				if (!(zipFile instanceof ZipFile)) {
					const zipFileInternal = zipFile;
					zipFile = Object.create(ZipFileProto);

					for (let key in zipFileInternal) {
						if (zipFileInternal.hasOwnProperty(key) && ['domain', '_events', '_eventsCount', '_maxListeners'].indexOf(key) == -1) zipFile[key] = zipFileInternal[key];
					}

					// Forward events from internal ZipFile to exposed one
					zipFileInternal.on('close', () => zipFile.emit('close'));
					zipFileInternal.on('error', err => zipFile.emit('error', err));
				}

				// Init
				zipFile._reading = false;
				zipFile._closing = false;
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
			if (this._reading) return reject(new Error('Previous read has not completed yet'));
			// NB No need to check for `_closing` as `isOpen` check above
			// will prevent close being called twice

			this._closing = true;
			this._resolver = {resolve, reject};
			close.call(this);
		});
	};
}

function closeDone(zipFile, event, value, resolver) {
	const {resolve, reject} = resolver;

	// Unset reading flag
	zipFile._closing = false;

	// Handle event
	if (event == 'close') {
		resolve();
	} else if (event == 'error') {
		reject(value);
	} else {
		reject(new Error(`Unexpected event '${event} emitted'`));
	}
}

/*
 * Promisify ZipFile `readEntry` method
 */
function promisifyReadEntry(ZipFile, Promise) {
	const readEntry = ZipFile.prototype.readEntry;

	ZipFile.prototype.readEntry = function() {
		return new Promise((resolve, reject) => {
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

function readEntryDone(zipFile, event, value, resolver) {
	const {resolve, reject} = resolver;

	// Unset reading flag
	zipFile._reading = false;

	// Handle event
	if (event == 'entry') {
		// Convert to instance of modified Entry class
		const {Entry} = zipFile.constructor;
		if (!(value instanceof Entry)) value = setPrototype(value, Entry.prototype);

		// Set reference to zipFile on entry (used by `entry.openReadStream()`)
		value.zipFile = zipFile;

		resolve(value);
	} else if (event == 'end') {
		resolve(null);
	} else if (event == 'error') {
		reject(value);
	} else {
		reject(new Error(`Unexpected event '${event} emitted'`));
	}
}

/*
 * Replacement `emit` method
 * Captures calls to `zipFile.emit()` from inside yauzl's `._readEntry()` method
 * or following on from `.close()` call.
 * Events are passed to read or close handler to resolve/reject that promise.
 */
function emit(event, value) {
	// Get resolver and destroy
	const resolver = this._resolver;
	this._resolver = undefined;

	// Call handler
	if (this._reading) {
		readEntryDone(this, event, value, resolver);
	} else if (this._closing) {
		closeDone(this, event, value, resolver);
	} else {
		throw new Error(`Unexpected event '${event} emitted'`);
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
