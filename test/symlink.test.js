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

/* It unzips, reads and checks if any entry is a symlink. */
describe('Identify symlinks', () => {

	it('reads symlink from NodeJS generated zip file', async () => {
		const zipPath = path.resolve('test', 'fixtures', 'symlink', 'NodeJS_text_file_with_symlink.zip');
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

	it('reads symlink from WinZip generated zip file', async () => {
		const zipPath = path.resolve('test', 'fixtures', 'symlink', 'WinZip_text_file_with_symlink.zip');
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
			{fileName: 'winzip/', isSymlink: false},
			{fileName: 'winzip/file.txt', isSymlink: false},
			{fileName: 'winzip/file_symlink.lnk', isSymlink: true}
		]);
	});

	it('reads symlink from 7-Zip generated zip file', async () => {
		const zipPath = path.resolve('test', 'fixtures', 'symlink', '7-Zip_text_file_with_symlink.zip');
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
			{fileName: '7zip/', isSymlink: false},
			{fileName: '7zip/file.txt', isSymlink: false},
			{fileName: '7zip/file_symlink.lnk', isSymlink: true}
		]);
	});

	it('reads symlink from WinRAR generated zip file', async () => {
		const zipPath = path.resolve('test', 'fixtures', 'symlink', 'WinRAR_text_file_with_symlink.zip');
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
			{fileName: 'winrar/', isSymlink: false},
			{fileName: 'winrar/file.txt', isSymlink: false},
			{fileName: 'winrar/file_symlink.lnk', isSymlink: true}
		]);
	});

	it('reads symlink from MacOS Archive Utility generated zip file', async () => {
		const zipPath = path.resolve('test', 'fixtures', 'symlink', 'MacOS_Archive_Utility_text_with_symlink.zip');
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
			{fileName: 'MacOS Archive Utility/', isSymlink: false},
			{fileName: 'MacOS Archive Utility/file.txt', isSymlink: false},
			{fileName: 'MacOS Archive Utility/.DS_Store', isSymlink: false},
			{fileName: '__MACOSX/MacOS Archive Utility/._.DS_Store', isSymlink: false},
			{fileName: 'MacOS Archive Utility/file.txt alias', isSymlink: true},
			{fileName: '__MACOSX/MacOS Archive Utility/._file.txt alias', isSymlink: true},
		]);
	});
});
