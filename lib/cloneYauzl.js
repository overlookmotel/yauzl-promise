/* --------------------
 * yauzl-promise module
 * Clone yauzl object
 * ------------------*/

'use strict';

// Modules
const util = require('util');

// Exports
module.exports = function(yauzl) {
	// Clone main object
	yauzl = Object.assign({}, yauzl);

	// Subclass ZipFile
	const ZipFileOriginal = yauzl.ZipFile;
	function ZipFile() {
		ZipFileOriginal.apply(this, arguments);
	}
	util.inherits(ZipFile, ZipFileOriginal);
	yauzl.ZipFile = ZipFile;

	// Subclass Entry
	const EntryOriginal = yauzl.Entry;
	function Entry() {
		EntryOriginal.apply(this, arguments);
	}
	util.inherits(Entry, EntryOriginal);
	yauzl.Entry = Entry;

	// Return cloned copy of yauzl
	return yauzl;
};
