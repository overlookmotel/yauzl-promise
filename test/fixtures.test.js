/* --------------------
 * yauzl-promise module
 * Tests
 * ------------------*/

/* eslint jest/no-standalone-expect: ["error", {"additionalTestBlockFunctions": ["testEachFile"]}] */
/* eslint-disable jest/no-conditional-expect */

'use strict';

// Init
require('./support/index.js');

// Modules
const pathJoin = require('node:path').join,
	fs = require('node:fs'),
	yauzl = require('yauzl-promise');

// Imports
const {streamToBuffer, getFiles} = require('./support/utils.js');

// Tests

const SUCCESS_DIR = pathJoin(__dirname, 'fixtures/success'),
	FAILURE_DIR = pathJoin(__dirname, 'fixtures/failure');

// This is the date example ZIP files and their content files were made,
// so this timestamp will be earlier than all the ones stored in these test ZIP files
// (and probably all future ZIP files).
// No timezone awareness, because that's how MS-DOS rolls.
const EARLIEST_TIMESTAMP = new Date(2014, 7, 18, 0, 0, 0, 0);

testEachFile('Successfully unzips', SUCCESS_DIR, describe, (zipFilename, zipPath, options) => {
	const expectedFiles = getFiles(zipPath.slice(0, -4));

	it.each([
		['options.decodeStrings = true', true],
		['options.decodeStrings = false', false]
	])('%s', async (testName, decodeStrings) => {
		const zip = await yauzl.open(zipPath, {...options.zip, decodeStrings});

		try {
			let entryCount = 0;
			for await (const entry of zip) {
				entryCount++;

				let {filename, comment} = entry;
				if (decodeStrings) {
					expect(filename).toBeString();
					expect(comment).toBeString();
				} else {
					expect(filename).toBeInstanceOf(Buffer);
					expect(comment).toBeInstanceOf(Buffer);
					filename = manuallyDecodeString(filename);
					comment = manuallyDecodeString(comment);
				}

				expect(comment).toBe('');

				const timestamp = entry.getLastMod();
				expect(timestamp).toBeAfter(EARLIEST_TIMESTAMP);
				expect(timestamp).toBeBefore(new Date());

				for (const [from, to] of options.rename || []) {
					filename = filename.replace(from, to);
				}

				if (options.isEncrypted != null) expect(entry.isEncrypted()).toBe(options.isEncrypted);
				if (options.isCompressed != null) expect(entry.isCompressed()).toBe(options.isCompressed);

				if (filename.endsWith('/')) {
					expect(expectedFiles[filename]).toBeNull();
				} else {
					const stream = await entry.openReadStream(options.stream);
					const content = await streamToBuffer(stream);
					expect(content).toEqual(expectedFiles[filename]);
				}
			}

			expect(entryCount).toBe(Object.keys(expectedFiles).length);
		} finally {
			await zip.close();
		}
	});
});

testEachFile('Errors unzipping', FAILURE_DIR, it, async (zipFilename, zipPath, options) => {
	const expectedErrorMessage = zipFilename.replace(/(_\d+)?\.zip$/, '');

	const promise = (async () => {
		const zip = await yauzl.open(zipPath, options.zip);
		for await (const entry of zip) {
			const stream = await entry.openReadStream(options.stream);
			await streamToBuffer(stream);
		}
	})();
	await expect(promise).toReject();
	const err = await promise.catch(err => err); // eslint-disable-line no-shadow
	// Can't test is instance of Error as native errors are from different `Error`
	// constructor due to Jest running test in different realm
	expect(err).toBeObject();
	expect(err.message.replace(/[^a-zA-Z0-9., ]/g, '-')).toBe(expectedErrorMessage);
});

function testEachFile(name, dirPath, describeOrIt, testFn) {
	const filenames = fs.readdirSync(dirPath)
		.filter(filename => /\.zip$/.test(filename))
		.sort();

	describe(name, () => { // eslint-disable-line jest/valid-title
		describeOrIt.each(filenames.map((filename) => {
			const zipPath = pathJoin(dirPath, filename);

			let options = {};
			try {
				options = JSON.parse(fs.readFileSync(`${zipPath.slice(0, -4)}.json`));
			} catch (err) {
				if (err?.code !== 'ENOENT') throw err;
			}

			return [filename, zipPath, options];
		}))('%s', testFn);
	});
}

function manuallyDecodeString(filename) {
	// Filenames in this test suite are always utf8 compatible.
	filename = filename.toString('utf8')
		.replace('\\', '/');
	if (filename === '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f') {
		// Not doing the unicode path extra field decoding outside of yauzl. Just hardcode this answer.
		filename = '七个房间.txt';
	}
	return filename;
}
