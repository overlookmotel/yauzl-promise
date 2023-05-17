/* --------------------
 * yauzl-promise
 * Tests utils
 * ------------------*/

'use strict';

// Modules
const pathJoin = require('path').join,
	fs = require('fs');

// Imports
const {streamToBuffer} = require('../../lib/utils.js');

// Exports

module.exports = {streamToString, streamToBuffer, getFiles};

/**
 * Drain contents of a readable stream into a string.
 * @param {Object} stream - Readable stream
 * @returns {string} - String
 */
async function streamToString(stream) {
	const buffer = await streamToBuffer(stream);
	return buffer.toString();
}

/**
 * Get list of files in a directory.
 * @param {string} dirPath - Path to directory
 * @returns {Array<string>} - Array of file paths
 */
function getFiles(dirPath) {
	const files = Object.create(null);
	getFilesForDir(dirPath, '', files);
	return files;
}

function getFilesForDir(fullPath, dirPath, files) {
	const dirents = fs.readdirSync(fullPath, {withFileTypes: true});
	for (const dirent of dirents) {
		const filename = dirPath ? `${dirPath}/${dirent.name}` : dirent.name;

		if (dirent.isDirectory()) {
			files[`${filename}/`] = null;
			getFilesForDir(pathJoin(fullPath, dirent.name), filename, files);
		} else if (dirent.name === '.dont_expect_an_empty_dir_entry_for_this_dir') {
			delete files[filename.slice(0, -'.dont_expect_an_empty_dir_entry_for_this_dir'.length)];
		} else if (!['.DS_Store', '.git_please_make_this_directory'].includes(dirent.name)) {
			files[filename] = fs.readFileSync(pathJoin(fullPath, dirent.name));
		}
	}
}
