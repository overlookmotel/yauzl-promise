/* --------------------
 * yauzl-promise module
 * Jest config
 * ------------------*/

'use strict';

// Exports

module.exports = {
	testEnvironment: 'node',
	coverageDirectory: 'coverage',
	collectCoverageFrom: ['index.js', 'lib/**/*.js'],
	setupFilesAfterEnv: ['jest-extended/all'],
	// Jest by default uses a number of workers equal to number of CPU cores minus 1.
	// Github Actions runners provide 2 cores and running with 2 workers is faster than 1.
	...(process.env.CI && {maxWorkers: '100%'})
};
