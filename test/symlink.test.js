/* --------------------
 * yauzl-promise module
 * Tests
 * ------------------*/

'use strict';

// Init
require('./support/index.js');

// Modules
const fs = require('fs'),
	path = require('path'),
	archiver = require('archiver'),
	yauzl = require('yauzl-promise');

describe('symlink', () => {
	const symlinkFixtureDirPath = path.resolve('test', 'fixtures', 'symlink');
	const filePath = path.resolve(symlinkFixtureDirPath, 'file.txt');
	const symlinkPath = path.resolve(symlinkFixtureDirPath, 'symlink_to_file.txt');
	const zipPath = path.resolve(symlinkFixtureDirPath, 'symlink.zip');

	beforeAll(async () => {
		/* Create file and symlink */
		await fs.promises.mkdir(symlinkFixtureDirPath, { recursive: true });
		await fs.promises.writeFile(filePath, 'some text');
		await fs.promises.symlink(filePath, symlinkPath);

		/* Create zip file */
		const writeStream = fs.createWriteStream(zipPath);
		const archive = archiver('zip');
		archive.pipe(writeStream);
		archive.file(filePath, { name: 'file.txt' });
		archive.file(symlinkPath, { name: 'symlink_to_file.txt' });
		await archive.finalize();
	});

	it('unzip, read and check if any entry is a symlink', async () => {
		const zip = await yauzl.open(zipPath);
		let entry = await zip.readEntry();
		const zipMetadata = [];
		while (entry !== null) {
			zipMetadata.push({
				fileName: entry.filename,
				isSymlink: await entry.isSymlink(),
			});
			entry = await zip.readEntry();
		}
		await zip.close();

		expect(zipMetadata).toEqual([
			{ fileName: 'file.txt', isSymlink: false },
			{ fileName: 'symlink_to_file.txt', isSymlink: true },
		]);
	});

	afterAll(async () => {
		await fs.promises.rm(symlinkFixtureDirPath, { recursive: true, force: true });
	});
});
