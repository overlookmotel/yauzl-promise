/* --------------------
 * yauzl-promise module
 * Tests
 * ------------------*/

/* eslint-disable jest/no-test-return-statement */

'use strict';

// Modules
const pathJoin = require('path').join,
	fs = require('fs'),
	fdSlicer = require('fd-slicer'),
	ReadableStream = require('stream').Readable,
	EventEmitter = require('events'),
	Bluebird = require('bluebird'),
	yauzlOriginal = require('yauzl'),
	yauzl = require('../index.js');

// Tests

const PATH = pathJoin(__dirname, 'fixtures/test.zip'),
	BAD_PATH = pathJoin(__dirname, 'fixtures/does-not-exist.zip'),
	FILES = ['test_files/', 'test_files/1.txt', 'test_files/2.txt', 'test_files/3.txt'];

// Run tests for yauzl object created with all methods
describe('Default module', () => {
	runTests(() => yauzl, Promise, true);
});

describe('.usePromise()', () => {
	runTests(() => yauzl.usePromise(Bluebird), Bluebird, true);
});

describe('.useYauzl()', () => {
	runTests(() => yauzl.useYauzl(yauzlOriginal), Promise, true);
});

describe('.use()', () => {
	runTests(() => yauzl.use(Bluebird, yauzlOriginal), Bluebird, true);
});

describe('.useYauzl() with options.clone = false', () => {
	runTests(() => yauzl.useYauzl(yauzlOriginal, {clone: false}), Promise, false);
});

function runTests(getYauzl, Promise, cloned) {
	// Inject `yauzl` into local scope at tests run time.
	// Doing at tests define time alters `yauzlOriginal` object in
	// `clone: false` run before tests on default behavior run.
	let yauzl; // eslint-disable-line no-shadow
	beforeAll(() => {
		yauzl = getYauzl();
	});

	// Test for cloning
	if (cloned) {
		describe('clones', () => {
			it('yauzl object', () => {
				expect(yauzl).not.toBe(yauzlOriginal);
			});

			it('yauzl.ZipFile', () => {
				const {ZipFile} = yauzl;
				expect(ZipFile).not.toBe(yauzlOriginal.ZipFile);

				const zipFile = Object.create(ZipFile.prototype);
				expect(zipFile).toBeInstanceOf(ZipFile);
				expect(zipFile).toBeInstanceOf(yauzlOriginal.ZipFile);
				expect(zipFile).toBeInstanceOf(EventEmitter);
			});

			it('yauzl.Entry', () => {
				const {Entry} = yauzl;
				expect(Entry).not.toBe(yauzlOriginal.Entry);

				const entry = Object.create(Entry.prototype);
				expect(entry).toBeInstanceOf(Entry);
				expect(entry).toBeInstanceOf(yauzlOriginal.Entry);
			});
		});
	} else {
		it('does not clone yauzl', () => {
			expect(yauzl).toBe(yauzlOriginal);
		});
	}

	// Run tests on each access method
	describe('Zip file accessed with .open()', () => {
		describe('.open()', () => {
			it('returns rejected promise if IO error', () => {
				const promise = yauzl.open(BAD_PATH);
				expect(promise).toBeInstanceOf(Promise);
				return expect(promise).toReject();
			});
		});

		runMainTests('open', options => yauzl.open(PATH, options), () => yauzl, Promise);
	});

	describe('Zip file accessed with .fromFd()', () => {
		runMainTests('fromFd', (options) => {
			const fd = fs.openSync(PATH, 'r');
			return yauzl.fromFd(fd, options);
		}, () => yauzl, Promise);
	});

	describe('Zip file accessed with .fromBuffer()', () => {
		runMainTests('fromBuffer', (options) => {
			const buffer = fs.readFileSync(PATH);
			return yauzl.fromBuffer(buffer, options);
		}, () => yauzl, Promise);
	});

	describe('Zip file accessed with .fromRandomAccessReader()', () => {
		runMainTests('fromRandomAccessReader', (options) => {
			const buffer = fs.readFileSync(PATH);
			const reader = fdSlicer.createFromBuffer(buffer);
			reader.unref = yauzl.RandomAccessReader.prototype.unref;
			reader.close = cb => cb();

			return yauzl.fromRandomAccessReader(reader, buffer.length, options);
		}, () => yauzl, Promise);
	});
}

function runMainTests(methodName, method, getYauzl, Promise) {
	// Inject `yauzl` into local scope at tests run time.
	// Doing at tests define time alters `yauzlOriginal` object in
	// `clone: false` run before tests on default behavior run.
	let yauzl; // eslint-disable-line no-shadow
	beforeAll(() => {
		yauzl = getYauzl();
	});

	describe(`.${methodName}()`, () => {
		it('returns a Promise', () => {
			const promise = method();
			expect(promise).toBeInstanceOf(Promise);

			return promise.then(zipFile => zipFile.close());
		});

		it('resolves to instance of yauzl.ZipFile', () => method().then((zipFile) => {
			expect(zipFile).toBeInstanceOf(yauzl.ZipFile);
			return zipFile.close();
		}));

		it('ignores `lazyEntries` option', () => method({lazyEntries: false}).then((zipFile) => {
			expect(zipFile.lazyEntries).toBeTrue();
			return zipFile.close();
		}));

		it('ignores `autoClose` option', () => method({autoClose: true}).then((zipFile) => {
			expect(zipFile.autoClose).toBeFalse();
			return zipFile.close();
		}));
	});

	describe('.close()', () => {
		it('returns a Promise', () => method().then((zipFile) => {
			const promise = zipFile.close();
			expect(promise).toBeInstanceOf(Promise);
			return promise;
		}));
	});

	describe('entry methods', () => {
		let zipFile;
		beforeEach(() => method().then((thisZipFile) => {
			zipFile = thisZipFile;
		}));

		afterEach(() => zipFile.close());

		describe('.readEntry()', () => {
			let promise, entry;
			beforeEach(() => {
				promise = zipFile.readEntry();
				return promise.then((thisEntry) => {
					entry = thisEntry;
				});
			});

			it('returns a Promise', () => {
				expect(promise).toBeInstanceOf(Promise);
			});

			it('resolves to instance of yauzl.Entry', () => {
				expect(entry).toBeInstanceOf(yauzl.Entry);
			});

			it('returns first entry', () => {
				expect(entry.fileName).toBe(FILES[0]);
			});

			it('when called again, returns next entry', () => { // eslint-disable-line arrow-body-style
				return zipFile.readEntry()
					.then((nextEntry) => {
						expect(nextEntry.fileName).toBe(FILES[1]);
					});
			});

			it('returns `null` when all entries consumed', () => {
				expect(entry.fileName).toBe(FILES[0]);
				return zipFile.readEntry()
					.then((entry2) => {
						expect(entry2.fileName).toBe(FILES[1]);
						return zipFile.readEntry();
					}).then((entry3) => {
						expect(entry3.fileName).toBe(FILES[2]);
						return zipFile.readEntry();
					}).then((entry4) => {
						expect(entry4.fileName).toBe(FILES[3]);
						return zipFile.readEntry();
					})
					.then((entry5) => {
						expect(entry5).toBeNull();
					});
			});
		});

		describe('.readEntries()', () => {
			it('returns a Promise', () => {
				const promise = zipFile.readEntries();
				expect(promise).toBeInstanceOf(Promise);
				return promise;
			});

			it('returns array of `numEntries` entries', () => { // eslint-disable-line arrow-body-style
				return zipFile.readEntries(2)
					.then((entries) => {
						expect(entries).toBeArrayOfSize(2);
						expect(entries.map(entry => entry.fileName)).toEqual(FILES.slice(0, 2));
					});
			});

			it('when called again, returns next entries', () => { // eslint-disable-line arrow-body-style
				return zipFile.readEntries(2)
					.then(() => zipFile.readEntries(2))
					.then((entries) => {
						expect(entries).toBeArrayOfSize(2);
						expect(entries.map(entry => entry.fileName)).toEqual(FILES.slice(2, 4));
					});
			});

			// eslint-disable-next-line arrow-body-style
			it('with no `numEntries` specified, returns all entries', () => {
				return zipFile.readEntries()
					.then((entries) => {
						expect(entries).toBeArrayOfSize(FILES.length);
						expect(entries.map(entry => entry.fileName)).toEqual(FILES);
					});
			});
		});

		describe('.walkEntries()', () => {
			it('returns a Promise', () => {
				const promise = zipFile.walkEntries(() => {});
				expect(promise).toBeInstanceOf(Promise);
				return promise;
			});

			it('calls callback for each entry', () => {
				const entries = [];
				return zipFile.walkEntries((entry) => {
					entries.push(entry);
				}).then(() => {
					expect(entries.map(entry => entry.fileName)).toEqual(FILES);
				});
			});

			it('awaits promise returned by callback before reading next entry', () => {
				const events = [];
				let count = 0;
				return zipFile.walkEntries(() => {
					count++;
					events.push(`callback${count}`);

					return new Promise((resolve) => {
						setTimeout(() => {
							events.push(`resolve${count}`);
							resolve();
						}, 100);
					});
				}).then(() => {
					expect(events).toEqual([
						'callback1', 'resolve1',
						'callback2', 'resolve2',
						'callback3', 'resolve3',
						'callback4', 'resolve4'
					]);
				});
			});

			it('rejects promise if callback throws', () => {
				const err = new Error('test');
				const p = zipFile.walkEntries(() => {
					throw err;
				});
				return expect(p).rejects.toBe(err);
			});

			it('rejects promise if callback returns rejected promise', () => {
				const err = new Error('test');
				const p = zipFile.walkEntries(() => new Promise((resolve, reject) => reject(err)));
				return expect(p).rejects.toBe(err);
			});
		});

		describe('async iterator', () => {
			it('iterates entries', async () => {
				const filenames = [];
				for await (const entry of zipFile) {
					filenames.push(entry.fileName);
				}
				expect(filenames).toEqual(FILES);
			});
		});
	});

	describe('stream methods', () => {
		let zipFile, entry;
		beforeEach(() => { // eslint-disable-line arrow-body-style
			return method()
				.then((thisZipFile) => {
					zipFile = thisZipFile;
					return zipFile.readEntry();
				})
				.then((thisEntry) => {
					entry = thisEntry;
				});
		});

		afterEach(() => zipFile.close());

		describe('zipFile.openReadStream()', () => {
			let promise, stream;
			beforeEach(() => {
				promise = zipFile.openReadStream(entry);
				return promise.then((thisStream) => {
					stream = thisStream;
				});
			});

			afterEach(() => {
				stream.on('error', () => {}).destroy();
			});

			it('returns a Promise', () => {
				expect(promise).toBeInstanceOf(Promise);
			});

			it('resolves to Readable Stream', () => {
				expect(stream).toBeInstanceOf(ReadableStream);
			});
		});

		describe('entry.openReadStream()', () => {
			let promise, stream;
			beforeEach(() => {
				promise = entry.openReadStream();
				return promise.then((thisStream) => {
					stream = thisStream;
				});
			});

			afterEach(() => {
				stream.on('error', () => {}).destroy();
			});

			it('returns a Promise', () => {
				expect(promise).toBeInstanceOf(Promise);
			});

			it('resolves to Readable Stream', () => {
				expect(stream).toBeInstanceOf(ReadableStream);
			});
		});
	});
}
