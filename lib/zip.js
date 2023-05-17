/* --------------------
 * yauzl-promise module
 * `Zip` class
 * ------------------*/

'use strict';

// Modules
const calculateCrc32 = require('@node-rs/crc32').crc32,
	assert = require('simple-invariant'),
	{isPositiveIntegerOrZero} = require('is-it-type');

// Imports
const Entry = require('./entry.js'),
	{decodeBuffer, validateFilename, readUInt64LE} = require('./utils.js'),
	{INTERNAL_SYMBOL} = require('./shared.js');

// Exports

// Spec of ZIP format is here: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// Also: https://libzip.org/specifications/appnote_iz.txt

const EOCDR_WITHOUT_COMMENT_SIZE = 22,
	MAX_EOCDR_COMMENT_SIZE = 0xFFFF;

class Zip {
	/**
	 * Class representing ZIP file.
	 * Class is exported in public interface, for purpose of `instanceof` checks, but constructor cannot
	 * be called by user. This is enforced by use of private symbol `INTERNAL_SYMBOL`.
	 * @class
	 * @param {Object} testSymbol - Must be `INTERNAL_SYMBOL`
	 * @param {Object} reader - `Reader` to use to access the ZIP
	 * @param {number} size - Size of ZIP file in bytes
	 * @param {Object} options - Options
	 * @param {boolean} [options.decodeStrings=true] - Decode filenames and comments to strings
	 * @param {boolean} [options.validateEntrySizes=true] - Validate entry sizes
	 * @param {boolean} [options.validateFilenames=true] - Validate filenames
	 * @param {boolean} [options.strictFilenames=false] - Don't allow backslashes (`\`) in filenames
	 */
	constructor(testSymbol, reader, size, options) {
		assert(
			testSymbol === INTERNAL_SYMBOL,
			'Zip class cannot be instantiated directly. Use one of the static methods.'
		);

		this.reader = reader;
		this.size = size;
		Object.assign(this, options);
		this.isZip64 = null;
		this.entryCount = null;
		this.footerOffset = null;
		this.centralDirectoryOffset = null;
		this.centralDirectorySize = null;
		this.comment = null;
		this.numEntriesRead = 0;
		this._isReading = false;
		this._entryCursor = null;
	}

	/**
	 * Close ZIP file. Underlying reader will be closed.
	 * @async
	 * @returns {undefined}
	 */
	close() {
		return this.reader.close();
	}

	/**
	 * Getter for whether `Zip` is open for reading.
	 * @returns {boolean} - `true` if open
	 */
	get isOpen() {
		return this.reader.isOpen;
	}

	/**
	 * Locate Central Directory.
	 * @async
	 * @returns {undefined}
	 */
	async _init() {
		// Parse End of Central Directory Record + ZIP64 extension
		// to get location of the Central Directory
		const eocdrBuffer = await this._locateEocdr();
		this._parseEocdr(eocdrBuffer);
		if (this.isZip64) await this._parseZip64Eocdr();
		this._entryCursor = this.centralDirectoryOffset;
	}

	/**
	 * Locate End of Central Directory Record.
	 * @async
	 * @returns {Buffer} - Buffer containing EOCDR
	 */
	async _locateEocdr() {
		// Last field of the End of Central Directory Record is a variable-length comment.
		// The comment size is encoded in a 2-byte field in the EOCDR, which we can't find without trudging
		// backwards through the comment to find it.
		// As a consequence of this design decision, it's possible to have ambiguous ZIP file metadata
		// if a coherent EOCDR was in the comment.
		// Search backwards for a EOCDR signature.
		let bufferSize = EOCDR_WITHOUT_COMMENT_SIZE + MAX_EOCDR_COMMENT_SIZE;
		if (this.size < bufferSize) {
			assert(this.size >= EOCDR_WITHOUT_COMMENT_SIZE, 'End of Central Directory Record not found');
			bufferSize = this.size;
		}
		const bufferOffset = this.size - bufferSize;
		const buffer = await this.reader.read(bufferOffset, bufferSize);
		let pos;
		for (pos = bufferSize - EOCDR_WITHOUT_COMMENT_SIZE; pos >= 0; pos--) {
			if (buffer[pos] !== 0x50) continue;
			if (buffer.readUInt32LE(pos) !== 0x06054b50) continue;

			const commentLength = buffer.readUInt16LE(pos + 20);
			if (commentLength === bufferSize - pos - EOCDR_WITHOUT_COMMENT_SIZE) {
				this.footerOffset = bufferOffset + pos;
				return buffer.subarray(pos);
			}
		}
		throw new Error('End of Central Directory Record not found');
	}

	/**
	 * Parse End of Central Directory Record.
	 * Get Central Directory location, size and entry count.
	 * @param {Buffer} eocdrBuffer - Buffer containing EOCDR
	 * @returns {undefined}
	 */
	_parseEocdr(eocdrBuffer) {
		// Bytes 0-3: End of Central Directory Record signature = 0x06054b50
		// Bytes 4-5: Number of this disk
		const diskNumber = eocdrBuffer.readUInt16LE(4);
		assert(diskNumber === 0, 'Multi-disk ZIP files are not supported');
		// Bytes 6-7: Disk where Central Directory starts
		// Bytes 8-9: Number of Central Directory records on this disk
		// Bytes 10-11: Total number of Central Directory records
		this.entryCount = eocdrBuffer.readUInt16LE(10);
		// Bytes 12-15: Size of Central Directory (bytes)
		this.centralDirectorySize = eocdrBuffer.readUInt32LE(12);
		// Bytes 16-19: Offset of Central Directory
		this.centralDirectoryOffset = eocdrBuffer.readUInt32LE(16);
		// Bytes 22-...: Comment. Encoding is always CP437.
		// Copy buffer instead of slicing, so rest of buffer can be garbage collected.
		this.comment = this._decodeBuffer(eocdrBuffer, 22, eocdrBuffer.length, false, true);

		// Original Yauzl does not check `centralDirectorySize` here, only offset, though ZIP spec suggests
		// both should be checked. I suspect this is a bug in Yauzl, and it has remained undiscovered
		// because ZIP files with a Central Directory > 4 GiB are vanishingly rare
		// (would require millions of files, or thousands of files with very long filenames/comments).
		this.isZip64 = this.entryCount === 0xFFFF || this.centralDirectoryOffset === 0xFFFFFFFF
			|| this.centralDirectorySize === 0xFFFFFFFF;
	}

	/**
	 * Parse ZIP64 End of Central Directory Locator + Record.
	 * Get Central Directory location, size and entry count, where ZIP64 extension used.
	 * @async
	 * @returns {undefined}
	 */
	async _parseZip64Eocdr() {
		// Parse ZIP64 End of Central Directory Locator
		const zip64EocdlOffset = this.footerOffset - 20;
		assert(zip64EocdlOffset >= 0, 'Cannot locate ZIP64 End of Central Directory Locator');
		const zip64EocdlBuffer = await this.reader.read(zip64EocdlOffset, 20);
		// Bytes 0-3: ZIP64 End of Central Directory Locator signature = 0x07064b50
		assert(
			zip64EocdlBuffer.readUInt32LE(0) === 0x07064b50,
			'Invalid ZIP64 End of Central Directory Locator signature'
		);
		// Bytes 4-7 - Number of the disk with the start of the ZIP64 End of Central Directory Record
		// Bytes 8-15: Position of ZIP64 End of Central Directory Record
		const zip64EocdrOffset = readUInt64LE(zip64EocdlBuffer, 8);
		// Bytes 16-19: Total number of disks

		// Parse ZIP64 End of Central Directory Record
		assert(
			zip64EocdrOffset + 56 <= zip64EocdlOffset,
			'Cannot locate ZIP64 End of Central Directory Record'
		);
		const zip64EocdrBuffer = await this.reader.read(zip64EocdrOffset, 56);
		// Bytes 0-3: ZIP64 End of Central Directory Record signature = 0x06064b50
		assert(
			zip64EocdrBuffer.readUInt32LE(0) === 0x06064b50,
			'Invalid ZIP64 End of Central Directory Record signature'
		);
		// Bytes 4-11: Size of ZIP64 End of Central Directory Record (not inc first 12 bytes)
		const zip64EocdrSize = readUInt64LE(zip64EocdrBuffer, 4);
		assert(
			zip64EocdrOffset + zip64EocdrSize + 12 <= zip64EocdlOffset,
			'Invalid ZIP64 End of Central Directory Record'
		);
		// Bytes 12-13: Version made by
		// Bytes 14-15: Version needed to extract
		// Bytes 16-19: Number of this disk
		// Bytes 20-23: Number of the disk with the start of the Central Directory
		// Bytes 24-31: Total number of entries in the Central Directory on this disk
		// Bytes 32-39: Total number of entries in the Central Directory
		// Spec: "If an archive is in ZIP64 format and the value in this field is 0xFFFF, the size
		// will be in the corresponding 8 byte zip64 end of central directory field."
		// Original Yauzl expects correct entry count to always be recorded in ZIP64 EOCDR,
		// but have altered that here to be more spec-compliant. Ditto Central Directory size + offset.
		if (this.entryCount === 0xFFFF) this.entryCount = readUInt64LE(zip64EocdrBuffer, 32);
		// Bytes 40-47: Size of the Central Directory
		if (this.centralDirectorySize === 0xFFFFFFFF) {
			this.centralDirectorySize = readUInt64LE(zip64EocdrBuffer, 40);
		}
		// Bytes 48-55: Offset of start of Central Directory with respect to the starting disk number
		if (this.centralDirectoryOffset === 0xFFFFFFFF) {
			this.centralDirectoryOffset = readUInt64LE(zip64EocdrBuffer, 48);
		}
		// Bytes 56-...: ZIP64 extensible data sector

		// Record offset of start of footers.
		// Either start of ZIP64 EOCDR (if it butts up to ZIP64 EOCDL), or ZIP64 EOCDL.
		this.footerOffset = zip64EocdrOffset + zip64EocdrSize === zip64EocdlOffset
			? zip64EocdrOffset
			: zip64EocdlOffset;
	}

	/**
	 * Get next entry.
	 * @async
	 * @returns {Entry|null} - `Entry` object for next entry, or `null` if none remaining
	 */
	async readEntry() {
		assert(!this._isReading, 'Cannot call `readEntry()` before previous call\'s promise has settled');
		this._isReading = true;
		try {
			return await this._readEntry();
		} finally {
			this._isReading = false;
		}
	}

	/**
	 * Get next entry.
	 * Implementation for `readEntry()`. Should not be called directly.
	 * @async
	 * @returns {Entry|null} - `Entry` object for next entry, or `null` if none remaining
	 */
	async _readEntry() {
		if (this.numEntriesRead === this.entryCount) return null;

		// Read Central Directory entry
		assert(this._entryCursor + 46 <= this.footerOffset, 'Invalid Central Directory File Header');
		const entryBuffer = await this.reader.read(this._entryCursor, 46);
		// Bytes 0-3: Central Directory File Header signature
		assert(
			entryBuffer.readUInt32LE(0) === 0x02014b50,
			'Invalid Central Directory File Header signature'
		);

		// Bytes 4-5: Version made by
		const versionMadeBy = entryBuffer.readUInt16LE(4);
		// Bytes 6-7: Version needed to extract (minimum)
		const versionNeededToExtract = entryBuffer.readUInt16LE(6);
		// Bytes 8-9: General Purpose Bit Flag
		const generalPurposeBitFlag = entryBuffer.readUInt16LE(8);
		// Bytes 10-11: Compression method
		const compressionMethod = entryBuffer.readUInt16LE(10);
		// Bytes 12-13: File last modification time
		const lastModTime = entryBuffer.readUInt16LE(12);
		// Bytes 14-15: File last modification date
		const lastModDate = entryBuffer.readUInt16LE(14);
		// Bytes 16-17: CRC32
		const crc32 = entryBuffer.readUInt32LE(16);
		// Bytes 20-23: Compressed size
		let compressedSize = entryBuffer.readUInt32LE(20);
		// Bytes 24-27: Uncompressed size
		let uncompressedSize = entryBuffer.readUInt32LE(24);
		// Bytes 28-29: Filename length
		const filenameLength = entryBuffer.readUInt16LE(28);
		// Bytes 30-31: Extra field length
		const extraFieldLength = entryBuffer.readUInt16LE(30);
		// Bytes 32-33: File comment length
		const commentLength = entryBuffer.readUInt16LE(32);
		// Bytes 34-35: Disk number where file starts
		// Bytes 36-37: Internal file attributes
		const internalFileAttributes = entryBuffer.readUInt16LE(36);
		// Bytes 38-41: External file attributes
		const externalFileAttributes = entryBuffer.readUInt32LE(38);
		// Bytes 42-45: Relative offset of Local File Header
		let fileHeaderOffset = entryBuffer.readUInt32LE(42);

		// eslint-disable-next-line no-bitwise
		assert((generalPurposeBitFlag & 0x40) === 0, 'Strong encryption is not supported');

		// Get filename
		const extraDataOffset = this._entryCursor + 46,
			extraDataSize = filenameLength + extraFieldLength + commentLength;
		assert(
			extraDataOffset + extraDataSize <= this.footerOffset,
			'Invalid Central Directory File Header'
		);
		const extraBuffer = await this.reader.read(extraDataOffset, extraDataSize);
		const isUtf8 = (generalPurposeBitFlag & 0x800) !== 0; // eslint-disable-line no-bitwise
		let filename = this._decodeBuffer(extraBuffer, 0, filenameLength, isUtf8, false);

		// Get extra fields
		const commentStart = filenameLength + extraFieldLength;
		const extraFieldBuffer = extraBuffer.subarray(filenameLength, commentStart);
		let i = 0;
		const extraFields = [];
		let zip64EiefBuffer;
		while (i < extraFieldBuffer.length - 3) {
			const headerId = extraFieldBuffer.readUInt16LE(i + 0),
				dataSize = extraFieldBuffer.readUInt16LE(i + 2),
				dataStart = i + 4,
				dataEnd = dataStart + dataSize;
			assert(dataEnd <= extraFieldBuffer.length, 'Extra field length exceeds extra field buffer size');
			let dataBuffer = extraFieldBuffer.subarray(dataStart, dataEnd);
			// If decoding strings, clone so rest of buffer containing strings can be garbage collected
			if (this.decodeStrings) dataBuffer = Buffer.from(dataBuffer);
			extraFields.push({id: headerId, data: dataBuffer});
			i = dataEnd;

			if (headerId === 1) zip64EiefBuffer = dataBuffer;
		}

		// Get file comment
		const comment = this._decodeBuffer(extraBuffer, commentStart, extraDataSize, isUtf8, false);

		// Handle ZIP64
		const isZip64 = uncompressedSize === 0xFFFFFFFF || compressedSize === 0xFFFFFFFF
			|| fileHeaderOffset === 0xFFFFFFFF;
		if (isZip64) {
			assert(zip64EiefBuffer, 'Expected ZIP64 Extended Information Extra Field');

			// @overlookmotel: According to the spec, I'd expect all 3 of these fields to be present,
			// but Yauzl's implementation makes them optional.
			// There may be a good reason for this, so leaving it as in Yauzl's implementation.
			let index = 0;

			// 8 bytes: Uncompressed size
			if (uncompressedSize === 0xFFFFFFFF) {
				assert(
					index + 8 <= zip64EiefBuffer.length,
					'ZIP64 Extended Information Extra Field does not include uncompressed size'
				);
				uncompressedSize = readUInt64LE(zip64EiefBuffer, index);
				index += 8;
			}
			// 8 bytes: Compressed size
			if (compressedSize === 0xFFFFFFFF) {
				assert(
					index + 8 <= zip64EiefBuffer.length,
					'ZIP64 Extended Information Extra Field does not include compressed size'
				);
				compressedSize = readUInt64LE(zip64EiefBuffer, index);
				index += 8;
			}
			// 8 bytes: Local File Header offset
			if (fileHeaderOffset === 0xFFFFFFFF) {
				assert(
					index + 8 <= zip64EiefBuffer.length,
					'ZIP64 Extended Information Extra Field does not include relative header offset'
				);
				fileHeaderOffset = readUInt64LE(zip64EiefBuffer, index);
				index += 8;
			}
			// 4 bytes: Disk Start Number
		}

		// Check for Info-ZIP Unicode Path Extra Field (0x7075).
		// See: https://github.com/thejoshwolfe/yauzl/issues/33
		if (this.decodeStrings) {
			for (const extraField of extraFields) {
				if (extraField.id !== 0x7075) continue;
				if (extraField.data.length < 6) continue; // Too short to be meaningful
				// Check version is 1. "Changes may not be backward compatible so this extra
				// field should not be used if the version is not recognized."
				if (extraField.data[0] !== 1) continue;
				// Check CRC32 matches original filename.
				// "The NameCRC32 is the standard zip CRC32 checksum of the File Name
				// field in the header. This is used to verify that the header
				// File Name field has not changed since the Unicode Path extra field
				// was created. This can happen if a utility renames the File Name but
				// does not update the UTF-8 path extra field. If the CRC check fails,
				// this UTF-8 Path Extra Field SHOULD be ignored and the File Name field
				// in the header SHOULD be used instead."
				const oldNameCrc32 = extraField.data.readUInt32LE(1);
				if (calculateCrc32(extraBuffer.subarray(0, filenameLength)) !== oldNameCrc32) continue;
				filename = decodeBuffer(extraField.data, 5, extraField.data.length, true);
				break;
			}
		}

		// Validate file size
		if (this.validateEntrySizes && compressionMethod === 0) {
			// Lowest bit of General Purpose Bit Flag is for traditional encryption.
			// Traditional encryption prefixes the file data with a header.
			const expectedCompressedSize = (generalPurposeBitFlag & 0x1) // eslint-disable-line no-bitwise
				? uncompressedSize + 12
				: uncompressedSize;
			assert(
				compressedSize === expectedCompressedSize,
				'Compressed/uncompressed size mismatch for stored file: '
				+ `${compressedSize} !== ${expectedCompressedSize}`
			);
		}

		// Minimum length of Local File Header = 30
		assert(fileHeaderOffset + 30 <= this.footerOffset, 'Invalid location for file data');

		// Validate filename
		if (this.decodeStrings && this.validateFilenames) {
			// Allow backslash if `strictFilenames` option disabled
			if (!this.strictFilenames) filename = filename.replace(/\\/g, '/');
			validateFilename(filename);
		}

		// Advance cursor to next entry
		this._entryCursor = extraDataOffset + extraDataSize;
		this.numEntriesRead++;

		// Return `Entry` instance
		return new Entry(INTERNAL_SYMBOL, {
			filename,
			compressedSize,
			uncompressedSize,
			compressionMethod,
			fileHeaderOffset,
			fileDataOffset: null,
			isZip64,
			crc32,
			lastModTime,
			lastModDate,
			comment,
			extraFields,
			versionMadeBy,
			versionNeededToExtract,
			generalPurposeBitFlag,
			internalFileAttributes,
			externalFileAttributes,
			zip: this
		});
	}

	/**
	 * Read multiple entries.
	 * If `numEntries` is provided, will read at maximum that number of entries.
	 * Otherwise, reads all entries.
	 * @async
	 * @param {number} [numEntries] - Number of entries to read
	 * @returns {Array<Entry>} - Array of entries
	 */
	async readEntries(numEntries) {
		if (numEntries != null) {
			assert(isPositiveIntegerOrZero(numEntries), '`numEntries` must be a positive integer if provided');
		} else {
			numEntries = Infinity;
		}

		const entries = [];
		for (let i = 0; i < numEntries; i++) {
			const entry = await this.readEntry();
			if (!entry) break;
			entries.push(entry);
		}
		return entries;
	}

	/**
	 * Get async iterator for entries.
	 * Usage: `for await (const entry of zip) { ... }`
	 * @returns {Object} - Async iterator
	 */
	[Symbol.asyncIterator]() {
		return {
			next: async () => {
				const entry = await this.readEntry();
				return {value: entry, done: entry === null};
			}
		};
	}

	/**
	 * Get readable stream for file data.
	 * @async
	 * @param {Entry} entry - `Entry` object
	 * @param {Object} [options] - Options
	 * @param {boolean} [options.decompress] - `false` to output raw data without decompression
	 * @param {boolean} [options.decrypt] - `true` to decrypt if is encrypted
	 * @param {number} [options.start] - Start offset (only valid if not decompressing)
	 * @param {number} [options.end] - End offset (only valid if not decompressing)
	 * @returns {Object} - Readable stream
	 */
	async openReadStream(entry, options) {
		assert(entry instanceof Entry, '`entry` must be an instance of `Entry`');
		assert(entry.zip === this, '`entry` must be an `Entry` from this ZIP file');
		return await entry.openReadStream(options);
	}

	/**
	 * Decode a buffer to string if `decodeStrings` option set.
	 * Otherwise, slice/copy buffer.
	 * @param {Buffer} buffer - Buffer
	 * @param {number} start - Start offset
	 * @param {number} end - End offset
	 * @param {boolean} isUtf8 - `true` if UTF8
	 * @param {boolean} copy - `true` to copy buffer rather than slice
	 * @returns {string|Buffer} - Decoded data
	 */
	_decodeBuffer(buffer, start, end, isUtf8, copy) {
		if (!this.decodeStrings) {
			if (start === end) return Buffer.allocUnsafe(0);
			const slice = buffer.subarray(start, end);
			return copy ? Buffer.from(slice) : slice;
		}

		return decodeBuffer(buffer, start, end, isUtf8);
	}
}

module.exports = Zip;
