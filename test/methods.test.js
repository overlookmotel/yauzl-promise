/* --------------------
 * yauzl-promise module
 * Tests
 * ------------------*/

'use strict';

// Init
require('./support/index.js');

// Modules
const pathJoin = require('node:path').join,
	fs = require('node:fs'),
	{promisify} = require('node:util'),
	ReadableStream = require('node:stream').Readable,
	yauzl = require('yauzl-promise');

const openAsync = promisify(fs.open);

// Imports
const {streamToString} = require('./support/utils.js');

// Tests

const PATH = pathJoin(__dirname, 'fixtures/basic/test.zip'),
	BAD_PATH = pathJoin(__dirname, 'fixtures/basic/does-not-exist.zip'),
	FILES = ['test_files/', 'test_files/1.txt', 'test_files/2.txt', 'test_files/3.txt'];

const FILE_CONTENTS = Object.create(null);
for (const filename of FILES) {
	if (filename.endsWith('/')) continue;
	FILE_CONTENTS[filename] = fs.readFileSync(pathJoin(__dirname, 'fixtures/basic', filename), 'utf8');
}

const ZIP_BUFFER = fs.readFileSync(PATH);

describe('.open()', () => {
	defineTests('open', () => yauzl.open(PATH));

	it('returns rejected promise if IO error', () => {
		const promise = yauzl.open(BAD_PATH);
		expect(promise).toBeInstanceOf(Promise);
		return expect(promise).toReject(); // eslint-disable-line jest/no-test-return-statement
	});
});

describe('.fromFd()', () => {
	let fd;
	beforeEach(async () => {
		fd = await openAsync(PATH);
	});

	defineTests('fromFd', () => yauzl.fromFd(fd));
});

describe('.fromBuffer()', () => {
	defineTests('fromBuffer', () => yauzl.fromBuffer(Buffer.from(ZIP_BUFFER)));
});

describe('.fromReader()', () => {
	class MyReader extends yauzl.Reader {
		async _read(start, length) { // eslint-disable-line class-methods-use-this
			return ZIP_BUFFER.subarray(start, start + length);
		}

		_createReadStream(start, length) { // eslint-disable-line class-methods-use-this
			return ReadableStream.from(ZIP_BUFFER.subarray(start, start + length));
		}
	}

	defineTests('fromReader', () => yauzl.fromReader(new MyReader(), ZIP_BUFFER.length));
});

function defineTests(methodName, method) {
	it(`.${methodName}() returns a Promise of Zip object`, async () => {
		const promise = method();
		expect(promise).toBeInstanceOf(Promise);
		const zip = await promise;
		expect(zip).toBeInstanceOf(yauzl.Zip);
	});

	it('.close() returns a Promise', async () => {
		const zip = await method();

		const promise = zip.close();
		expect(promise).toBeInstanceOf(Promise);
		await promise;
	});

	describe('entry methods', () => {
		let zip;
		beforeEach(async () => {
			zip = await method();
		});

		afterEach(async () => {
			if (zip) await zip.close();
		});

		describe('.readEntry()', () => {
			let promise, entry;
			beforeEach(async () => {
				promise = zip.readEntry();
				entry = await promise;
			});

			it('returns a Promise resolving to `Entry` object', () => {
				expect(promise).toBeInstanceOf(Promise);
				expect(entry).toBeInstanceOf(yauzl.Entry);
			});

			it('returns first entry', () => {
				expect(entry.filename).toBe(FILES[0]);
			});

			it('when called again, returns next entry', async () => {
				const nextEntry = await zip.readEntry();
				expect(nextEntry.filename).toBe(FILES[1]);
			});

			it('returns `null` when all entries consumed', async () => {
				expect(entry.filename).toBe(FILES[0]);
				let nextEntry = await zip.readEntry();
				expect(nextEntry.filename).toBe(FILES[1]);
				nextEntry = await zip.readEntry();
				expect(nextEntry.filename).toBe(FILES[2]);
				nextEntry = await zip.readEntry();
				expect(nextEntry.filename).toBe(FILES[3]);
				nextEntry = await zip.readEntry();
				expect(nextEntry).toBeNull();
			});
		});

		describe('.readEntries()', () => {
			it('returns a Promise', async () => {
				const promise = zip.readEntries();
				expect(promise).toBeInstanceOf(Promise);
				await promise;
			});

			it('returns array of `numEntries` entries', async () => {
				const entries = await zip.readEntries(2);
				expect(entries).toBeArrayOfSize(2);
				expect(entries.map(entry => entry.filename)).toEqual(FILES.slice(0, 2));
			});

			it('when called again, returns next entries', async () => {
				let entries = await zip.readEntries(2);
				entries = await zip.readEntries(2);
				expect(entries).toBeArrayOfSize(2);
				expect(entries.map(entry => entry.filename)).toEqual(FILES.slice(2, 4));
			});

			it('with no `numEntries` specified, returns all entries', async () => {
				const entries = await zip.readEntries();
				expect(entries).toBeArrayOfSize(FILES.length);
				expect(entries.map(entry => entry.filename)).toEqual(FILES);
			});
		});

		describe('async iterator', () => {
			it('iterates entries', async () => {
				const filenames = [];
				for await (const entry of zip) {
					filenames.push(entry.filename);
				}
				expect(filenames).toEqual(FILES);
			});
		});
	});

	describe('stream methods', () => {
		let zip, entry;
		beforeEach(async () => {
			zip = await method();
			await zip.readEntry();
			entry = await zip.readEntry();
		});

		afterEach(async () => {
			if (zip) await zip.close();
		});

		describe('zip.openReadStream()', () => {
			let promise, stream;
			beforeEach(async () => {
				promise = zip.openReadStream(entry);
				stream = await promise;
				stream.on('error', () => {}); // Avoid unhandled error events crashing tests
			});

			afterEach(async () => {
				stream.destroy();
				await new Promise((resolve) => { setTimeout(resolve, 0); });
			});

			it('returns a Promise', () => {
				expect(promise).toBeInstanceOf(Promise);
			});

			it('promise resolves to Readable Stream', () => {
				expect(stream).toBeInstanceOf(ReadableStream);
			});

			it('streams file data', async () => {
				const entries = [entry, ...await zip.readEntries()];

				for (const [index, entry] of entries.entries()) { // eslint-disable-line no-shadow
					expect(entry.filename).toBe(FILES[index + 1]);
					const stream = await zip.openReadStream(entry); // eslint-disable-line no-shadow
					const data = await streamToString(stream);
					expect(data).toBe(FILE_CONTENTS[entry.filename]);
				}
			});
		});

		describe('entry.openReadStream()', () => {
			let promise, stream;
			beforeEach(async () => {
				promise = zip.openReadStream(entry);
				stream = await promise;
				stream.on('error', () => {}); // Avoid unhandled error events crashing tests
			});

			afterEach(async () => {
				stream.destroy();
				await new Promise((resolve) => { setTimeout(resolve, 0); });
			});

			it('returns a Promise', () => {
				expect(promise).toBeInstanceOf(Promise);
			});

			it('resolves to Readable Stream', () => {
				expect(stream).toBeInstanceOf(ReadableStream);
			});

			it('streams file data', async () => {
				const entries = [entry, ...await zip.readEntries()];

				for (const [index, entry] of entries.entries()) { // eslint-disable-line no-shadow
					expect(entry.filename).toBe(FILES[index + 1]);
					const stream = await zip.openReadStream(entry); // eslint-disable-line no-shadow
					const data = await streamToString(stream);
					expect(data).toBe(FILE_CONTENTS[entry.filename]);
				}
			});
		});
	});

	it('can stream multiple files simultaneously', async () => {
		const zip = await method();
		try {
			const entries = await zip.readEntries();
			entries.shift();
			const contents = await Promise.all(entries.map(
				async entry => streamToString(await entry.openReadStream())
			));
			for (const [index, entry] of entries.entries()) {
				expect(contents[index]).toBe(FILE_CONTENTS[entry.filename]);
			}
		} finally {
			await zip.close();
		}
	});

	it('destroying stream does not close file descriptor', async () => {
		const zip = await method();
		try {
			const entries = await zip.readEntries();

			const stream1 = await entries[1].openReadStream();
			stream1.destroy();
			await new Promise((resolve) => { setTimeout(resolve, 100); });

			const stream2 = await entries[1].openReadStream();
			const content2 = await streamToString(stream2);
			expect(content2).toBe(FILE_CONTENTS[entries[1].filename]);

			const stream3 = await entries[2].openReadStream();
			const content3 = await streamToString(stream3);
			expect(content3).toBe(FILE_CONTENTS[entries[2].filename]);
		} finally {
			await zip.close();
		}
	});
}
