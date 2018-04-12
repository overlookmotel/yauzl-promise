/* --------------------
 * yauzl-promise module
 * ------------------*/

'use strict';

// Modules
const yauzlOriginal = require('yauzl');

// Imports
const NativePromise = require('./promise'),
	cloneYauzl = require('./cloneYauzl'),
	promisify = require('./promisify');

// Exports
function use(Promise, yauzl) {
	// Use defaults if not provided
	if (!Promise) Promise = NativePromise;
	if (!yauzl) yauzl = cloneYauzl(yauzlOriginal);

	// Add promisfied methods
	if (Promise) {
		promisify(yauzl, Promise);
	} else {
		yauzl = {};
	}

	// Add `use` methods
	yauzl.use = use;
	yauzl.usePromise = function(Promise) {
		return use(Promise, null);
	};
	yauzl.useYauzl = function(yauzl) {
		return use(null, yauzl);
	};

	// Return yauzl object
	return yauzl;
}

module.exports = use();
