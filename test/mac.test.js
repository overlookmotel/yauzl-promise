/* --------------------
 * yauzl-promise module
 * Tests
 * ------------------*/

'use strict';

// Init
require('./support/index.js');

// Modules
const pathJoin = require('path').join,
	yauzl = require('yauzl-promise');

// Imports
const {streamToBuffer, getFiles} = require('./support/utils.js');

// Tests

// NB: No tests for ZIP files >= 4 GiB as would require 4 GiB files as fixtures.
// Have tested on a large collection of Mac OS Archive Utility ZIP files ranging from 4 GiB to 100 GiB.

const FIXTURES_DIR = pathJoin(__dirname, 'fixtures/mac');

let zip;
afterEach(async () => {
	if (zip) await zip.close();
});

it('handles empty files', async () => {
	const zipPath = pathJoin(FIXTURES_DIR, 'empty-files.zip');
	const expectedFiles = getFiles(zipPath.slice(0, -4));

	zip = await yauzl.open(zipPath);
	await expectZipContentsToBeExpected(zip, expectedFiles);
	expect(zip.isMaybeMacArchive).toBeTrue();
});

it('handles folders', async () => {
	const zipPath = pathJoin(FIXTURES_DIR, 'folders.zip');
	const expectedFiles = getFiles(zipPath.slice(0, -4));

	zip = await yauzl.open(zipPath);
	await expectZipContentsToBeExpected(zip, expectedFiles);
	expect(zip.isMaybeMacArchive).toBeTrue();
});

async function expectZipContentsToBeExpected(zip, expectedFiles) { // eslint-disable-line no-shadow
	let entryCount = 0;
	for await (const entry of zip) {
		entryCount++;

		expect(entry.comment).toBe('');

		const {filename} = entry;
		if (filename.endsWith('/')) {
			expect(expectedFiles[filename]).toBeNull();
		} else {
			const stream = await entry.openReadStream();
			const content = await streamToBuffer(stream);
			expect(content).toEqual(expectedFiles[filename]);
		}
	}

	expect(entryCount).toBe(Object.keys(expectedFiles).length);
}
