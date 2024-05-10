/* --------------------
 * yauzl-promise module
 * Tests
 * ------------------*/

'use strict';

// Init
require('./support/index.js');

// Modules
const path = require('path'),
	yauzl = require('yauzl-promise');

describe('Identify symlinks', () => {
	const zipPath = path.resolve('test', 'fixtures', 'symlink', 'node_generated.zip');

	it('unzips, reads and checks if any entry is a symlink', async () => {
		const zip = await yauzl.open(zipPath);
		const zipMetadata = [];

		try {
			for await (const entry of zip) {
				zipMetadata.push({
					fileName: entry.filename,
					isSymlink: entry.isSymlink()
				});
			}
		} finally {
			zip.close();
		}

		expect(zipMetadata).toEqual([
			{fileName: 'symlink_to_file.txt', isSymlink: true},
			{fileName: 'file.txt', isSymlink: false}
		]);
	});
});
