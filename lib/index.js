/* --------------------
 * yauzl-promise module
 * ------------------*/

'use strict';

// Modules
const yauzlOriginal = require('yauzl'),
	eventsIntercept = require('events-intercept');

// Imports
const NativePromise = require('./promise'),
	cloneYauzl = require('./cloneYauzl'),
	promisify = require('./promisify');

// Exports
function use(Promise, yauzl, options) {
	// Conform options
	options = Object.assign({clone: true}, options);

	// Use defaults if not provided
	if (!Promise) Promise = NativePromise;
	if (!yauzl) yauzl = yauzlOriginal;

	// Clone yauzl unless `options.clone` false
	if (options.clone) yauzl = cloneYauzl(yauzl);

	// Patch ZipFile prototype with events-intercept methods
	const ZipFileProto = yauzl.ZipFile.prototype;
	if (!ZipFileProto.intercept) {
		eventsIntercept.patch(ZipFileProto);
		['_events', '_eventsCount', '_interceptors'].forEach(key => delete ZipFileProto[key]);
	}

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
	yauzl.useYauzl = function(yauzl, options) {
		return use(null, yauzl, options);
	};

	// Return yauzl object
	return yauzl;
}

module.exports = use();
