/* --------------------
 * yauzl-promise module
 * Tests
 * ------------------*/

'use strict';

// Modules
const chai = require('chai'),
	{expect} = chai,
	chaiAsPromised = require('chai-as-promised'),
	pathJoin = require('path').join,
	fs = require('fs'),
	fdSlicer = require('fd-slicer'),
	ReadableStream = require('stream').Readable,
	EventEmitter = require('events'),
	Bluebird = require('bluebird'),
	yauzlOriginal = require('yauzl'),
	yauzl = require('../lib/');

// Init
chai.config.includeStack = true;
chai.use(chaiAsPromised);

// Tests

/* jshint expr: true */
/* global describe, it, beforeEach, afterEach, before */

const PATH = pathJoin(__dirname, 'test.zip'),
	BAD_PATH = pathJoin(__dirname, 'does-not-exist.zip'),
	FILES = ['test_files/', 'test_files/1.txt', 'test_files/2.txt', 'test_files/3.txt'];

// Run tests for yauzl object created with all methods
describe('Default module', function() {
	before(function() {
		this.Promise = Promise;
		this.yauzl = yauzl;
	});
	runTests(true);
});

describe('.usePromise()', function() {
	before(function() {
		this.Promise = Bluebird;
		this.yauzl = yauzl.usePromise(Bluebird);
	});
	runTests(true);
});

describe('.useYauzl()', function() {
	before(function() {
		this.Promise = Promise;
		this.yauzl = yauzl.useYauzl(yauzlOriginal);
	});
	runTests(true);
});

describe('.use()', function() {
	before(function() {
		this.Promise = Bluebird;
		this.yauzl = yauzl.use(Bluebird, yauzlOriginal);
	});
	runTests(true);
});

describe('.useYauzl() with options.clone = false', function() {
	before(function() {
		this.Promise = Promise;
		this.yauzl = yauzl.useYauzl(yauzlOriginal, {clone: false});
	});

	runTests(false);
});

function runTests(cloned) {
	// Inject `yauzl` and `Promise` into local scope at tests run time.
	// Doing at tests define time alters `yauzlOriginal` object in
	// `clone: false` run before tests on default behavior run.
	let yauzl, Promise;
	before(function() {
		yauzl = this.yauzl;
		Promise = this.Promise;
	});

	// Test for cloning
	if (cloned) {
		describe('clones', function() {
			it('yauzl object', function() {
				expect(yauzl).to.not.equal(yauzlOriginal);
			});

			it('yauzl.ZipFile', function() {
				const {ZipFile} = yauzl;
				expect(ZipFile).to.not.equal(yauzlOriginal.ZipFile);

				const zipFile = Object.create(ZipFile.prototype);
				expect(zipFile).to.be.instanceof(ZipFile);
				expect(zipFile).to.be.instanceof(yauzlOriginal.ZipFile);
				expect(zipFile).to.be.instanceof(EventEmitter);
			});

			it('yauzl.Entry', function() {
				const {Entry} = yauzl;
				expect(Entry).to.not.equal(yauzlOriginal.Entry);

				const entry = Object.create(Entry.prototype);
				expect(entry).to.be.instanceof(Entry);
				expect(entry).to.be.instanceof(yauzlOriginal.Entry);
			});
		});
	} else {
		it('does not clone yauzl', function() {
			expect(yauzl).to.equal(yauzlOriginal);
		});
	}

	// Run tests on each access method
	describe('Zip file accessed with .open()', function() {
		describe(`.open()`, function() {
			it('returns rejected promise if IO error', function() {
				const promise = yauzl.open(BAD_PATH);
				expect(promise).to.be.instanceof(Promise);
				return expect(promise).to.be.rejected;
			});
		});

		runMainTests('open', options => {
			return yauzl.open(PATH, options);
		});
	});

	describe('Zip file accessed with .fromFd()', function() {
		runMainTests('fromFd', options => {
			const fd = fs.openSync(PATH, 'r');
			return yauzl.fromFd(fd, options);
		});
	});

	describe('Zip file accessed with .fromBuffer()', function() {
		runMainTests('fromBuffer', options => {
			const buffer = fs.readFileSync(PATH);
			return yauzl.fromBuffer(buffer, options);
		});
	});

	describe('Zip file accessed with .fromRandomAccessReader()', function() {
		runMainTests('fromRandomAccessReader', options => {
			const buffer = fs.readFileSync(PATH);
			const reader = fdSlicer.createFromBuffer(buffer);
			reader.unref = yauzl.RandomAccessReader.prototype.unref;
			reader.close = cb => cb();

			return yauzl.fromRandomAccessReader(reader, buffer.length, options);
		});
	});
}

function runMainTests(methodName, method) {
	// Inject `yauzl` and `Promise` into local scope at tests run time.
	// Doing at tests define time alters `yauzlOriginal` object in
	// `clone: false` run before tests on default behavior run.
	let yauzl, Promise;
	before(function() {
		yauzl = this.yauzl;
		Promise = this.Promise;
	});

	describe(`.${methodName}()`, function() {
		it('returns a Promise', function() {
			const promise = method();
			expect(promise).to.be.instanceof(Promise);
			return promise.then(zipFile => {
				return zipFile.close();
			});
		});

		it('resolves to instance of yauzl.ZipFile', function() {
			return method().then(zipFile => {
				expect(zipFile).to.be.instanceof(yauzl.ZipFile);
				return zipFile.close();
			});
		});

		it('ignores `lazyEntries` option', function() {
			return method({lazyEntries: false}).then(zipFile => {
				expect(zipFile.lazyEntries).to.equal(true);
				return zipFile.close();
			});
		});

		it('ignores `autoClose` option', function() {
			return method({autoClose: true}).then(zipFile => {
				expect(zipFile.autoClose).to.equal(false);
				return zipFile.close();
			});
		});
	});

	describe('.close()', function() {
		it('returns a Promise', function() {
			return method().then(zipFile => {
				const promise = zipFile.close();
				expect(promise).to.be.instanceof(Promise);
				return promise;
			});
		});
	});

	describe('Entry methods', function() {
		beforeEach(function() {
			return method().then(zipFile => {
				this.zipFile = zipFile;
			});
		});

		afterEach(function() {
			return this.zipFile.close();
		});

		describe('.readEntry()', function() {
			beforeEach(function() {
				this.promise = this.zipFile.readEntry();
				return this.promise.then(entry => {
					this.entry = entry;
				});
			});

			it('returns a Promise', function() {
				expect(this.promise).to.be.instanceof(Promise);
			});

			it('resolves to instance of yauzl.Entry', function() {
				expect(this.entry).to.be.instanceof(yauzl.Entry);
			});

			it('returns first entry', function() {
				expect(this.entry.fileName).to.equal(FILES[0]);
			});

			it('when called again, returns next entry', function() {
				return this.zipFile.readEntry().then(entry => {
					expect(entry.fileName).to.equal(FILES[1]);
				});
			});

			it('returns `null` when all entries consumed', function() {
				expect(this.entry.fileName).to.equal(FILES[0]);
				return this.zipFile.readEntry().then(entry => {
					expect(entry.fileName).to.equal(FILES[1]);
					return this.zipFile.readEntry();
				}).then(entry => {
					expect(entry.fileName).to.equal(FILES[2]);
					return this.zipFile.readEntry();
				}).then(entry => {
					expect(entry.fileName).to.equal(FILES[3]);
					return this.zipFile.readEntry();
				}).then(entry => {
					expect(entry).to.be.null;
				});
			});
		});

		describe('async iterator', function() {
			it('iterates entries', async function() {
				let fileNames = [];
				for await (let entry of this.zipFile) {
					fileNames.push(entry.fileName);
				}

				expect(fileNames).to.deep.equal(FILES);
			});
		});

		describe('.readEntries()', function() {
			it('returns a Promise', function() {
				const promise = this.zipFile.readEntries();
				expect(promise).to.be.instanceof(Promise);
				return promise;
			});

			it('returns array of `numEntries` entries', function() {
				return this.zipFile.readEntries(2).then(entries => {
					expect(entries).to.be.an('array');
					expect(entries).to.have.lengthOf(2);
					const fileNames = entries.map(entry => entry.fileName);
					expect(fileNames).to.deep.equal(FILES.slice(0, 2));
				});
			});

			it('when called again, returns next entries', function() {
				return this.zipFile.readEntries(2).then(() => {
					return this.zipFile.readEntries(2);
				}).then(entries => {
					expect(entries).to.be.an('array');
					expect(entries).to.have.lengthOf(2);
					const fileNames = entries.map(entry => entry.fileName);
					expect(fileNames).to.deep.equal(FILES.slice(2, 4));
				});
			});

			it('with no `numEntries` specified, returns all entries', function() {
				return this.zipFile.readEntries().then(entries => {
					expect(entries).to.be.an('array');
					expect(entries).to.have.lengthOf(FILES.length);
					const fileNames = entries.map(entry => entry.fileName);
					expect(fileNames).to.deep.equal(FILES);
				});
			});
		});

		describe('.walkEntries()', function() {
			it('returns a Promise', function() {
				const promise = this.zipFile.walkEntries(() => {});
				expect(promise).to.be.instanceof(Promise);
				return promise;
			});

			it('calls callback for each entry', function() {
				const entries = [];
				return this.zipFile.walkEntries(entry => {
					entries.push(entry);
				}).then(() => {
					const fileNames = entries.map(entry => entry.fileName);
					expect(fileNames).to.deep.equal(FILES);
				});
			});

			it('awaits promise returned by callback before reading next entry', function() {
				const events = [];
				let count = 0;
				return this.zipFile.walkEntries(() => {
					count++;
					events.push(`callback${count}`);

					return new Promise(resolve => {
						setTimeout(() => {
							events.push(`resolve${count}`);
							resolve();
						}, 100);
					});
				}).then(() => {
					expect(events).to.deep.equal(['callback1', 'resolve1', 'callback2', 'resolve2', 'callback3', 'resolve3', 'callback4', 'resolve4']);
				});
			});

			it('rejects promise if callback throws', function() {
				const err = new Error('test');
				const p = this.zipFile.walkEntries(() => {
					throw err;
				});
				return expect(p).be.rejectedWith(err);
			});

			it('rejects promise if callback returns rejected promise', function() {
				const err = new Error('test');
				const p = this.zipFile.walkEntries(() => {
					return new Promise((resolve, reject) => reject(err)); // jshint ignore:line
				});
				return expect(p).be.rejectedWith(err);
			});
		});
	});

	describe('Stream methods', function() {
		beforeEach(function() {
			return method().then(zipFile => {
				this.zipFile = zipFile;
				return zipFile.readEntry();
			}).then(entry => {
				this.entry = entry;
			});
		});

		afterEach(function() {
			return this.zipFile.close();
		});

		describe('zipFile.openReadStream()', function() {
			beforeEach(function() {
				this.promise = this.zipFile.openReadStream(this.entry);
				return this.promise.then(stream => {
					this.stream = stream;
				});
			});

			afterEach(function() {
				this.stream.on('error', () => {}).destroy();
			});

			it('returns a Promise', function() {
				expect(this.promise).to.be.instanceof(Promise);
			});

			it('resolves to Readable Stream', function() {
				expect(this.stream).to.be.instanceof(ReadableStream);
			});
		});

		describe('entry.openReadStream()', function() {
			beforeEach(function() {
				this.promise = this.entry.openReadStream();
				return this.promise.then(stream => {
					this.stream = stream;
				});
			});

			afterEach(function() {
				this.stream.on('error', () => {}).destroy();
			});

			it('returns a Promise', function() {
				expect(this.promise).to.be.instanceof(Promise);
			});

			it('resolves to Readable Stream', function() {
				expect(this.stream).to.be.instanceof(ReadableStream);
			});
		});
	});
}
