/* --------------------
 * yauzl-promise module
 * Entry point
 * ------------------*/

'use strict';

// Modules
const yauzlOriginal = require('yauzl'),
	cloner = require('yauzl-clone');

// Imports
const promisify = require('./promisify.js');

// Exports

const NativePromise = Promise;

module.exports = use();

function use(Promise, yauzl, options) {
	// Conform options
	options = {clone: true, ...options};

	// Use defaults if not provided
	if (!Promise) Promise = NativePromise;
	if (!yauzl) yauzl = yauzlOriginal;

	// Clone yauzl unless `options.clone` false
	if (options.clone) {
		yauzl = cloner.clone(yauzl, {subclassZipFile: true, subclassEntry: true});
	} else {
		// Patch ZipFile prototype with events-intercept methods
		cloner.clone(yauzl, {clone: false, eventsIntercept: true});
	}

	// Add promisfied methods
	promisify(yauzl, Promise);

	// Add `use` methods
	yauzl.use = use;
	yauzl.usePromise = Promise => use(Promise, null); // eslint-disable-line no-shadow
	yauzl.useYauzl = (yauzl, options) => use(null, yauzl, options); // eslint-disable-line no-shadow

	// Return yauzl object
	return yauzl;
}
