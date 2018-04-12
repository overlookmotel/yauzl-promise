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

	// Promisify ZipFile `readEntry` method
	promisifyReadEntry(ZipFile, Promise);

	// Add ZipFile `readEntries` + `walkEntries` methods
	ZipFile.prototype.readEntries = readEntries;
	ZipFile.prototype.walkEntries = walkEntries;

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
			args[optionsArg] = Object.assign({}, args[optionsArg], {lazyEntries: true});

			args[cbArg] = (err, zipFile) => {
				if (err) return reject(err);

				// Convert to instance of modified ZipFile class
				zipFile = setPrototype(zipFile, ZipFileProto);
				zipFile._reading = false;
				zipFile._resolver = undefined;
				resolve(zipFile);
			};

			original.apply(this, args);
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
			this.on('entry', onEntry);
			this.on('end', onEnd);
			this.on('error', onError);

			readEntry.call(this);
		});
	};
}

function onEntry(entry) {
	// Convert to instance of modified Entry class
	entry = setPrototype(entry, this.constructor.Entry.prototype);

	// Set reference to zipFile on entry (used by `entry.openReadStream()`)
	entry.zipFile = this;

	const {resolve} = readDone(this);
	resolve(entry);
}

function onEnd() {
	const {resolve} = readDone(this);
	resolve(null);
}

function onError(err) {
	const {reject} = readDone(this);
	reject(err);
}

function readDone(zipFile) {
	// Clear event listeners
	zipFile.removeListener('entry', onEntry);
	zipFile.removeListener('end', onEnd);
	zipFile.removeListener('error', onError);

	// Unset reading flag
	zipFile._reading = false;

	// Clear and return resolver
	const {_resolver} = zipFile;
	zipFile._resolver = undefined;
	return _resolver;
}

/*
 * Read all ZipFile entries
 * Reads all entries and returns a promise which resolves with an array of entries
 * `options.max` limits number returned (default 100)
 * `options.max` can be set to `0` for no limit
 */
function readEntries(numEntries) {
	return readNextEntry(this, [], numEntries);
}

function readNextEntry(zipFile, entries, numEntries) {
	return zipFile.readEntry().then(entry => {
		if (!entry) return entries;

		entries.push(entry);
		if (numEntries && entries.length == numEntries) return entries;

		return readNextEntry(zipFile, entries, numEntries);
	});
}

/*
 * Walk all ZipFile entries
 * Walks through each entry and calls `fn` with each.
 * Returns a promise which resolves when all have been read.
 */
function walkEntries(callback) {
	return this.readEntry().then(entry => {
		if (!entry) return;

		callback(entry);

		return this.walkEntries(callback);
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
