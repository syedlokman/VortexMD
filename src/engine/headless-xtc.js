// src/headless-xtc.js
// Pure headless GROMACS XTC trajectory coordinate decompressor.
// Adapted from the canonical GROMACS XDR 3dfx compression specification (xdrfile.c,
// F. van Hoesel & E. Lindahl) and NGL XtcParser for zero-DOM Web Worker chunk streaming.

const MAGICINTS = new Uint32Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 10, 12, 16, 20, 25, 32, 40, 50, 64, 80,
    101, 128, 161, 203, 256, 322, 406, 512, 645, 812, 1024, 1290, 1625,
    2048, 2580, 3250, 4096, 5060, 6501, 8192, 10321, 13003, 16384, 20642,
    26007, 32768, 41285, 52015, 65536, 82570, 104031, 131072, 165140,
    208063, 262144, 330280, 416127, 524287, 660561, 832255, 1048576,
    1321122, 1664510, 2097152, 2642245, 3329021, 4194304, 5284491,
    6658042, 8388607, 10568983, 13316085, 16777216
]);

function sizeofint(size) {
    let num = 1;
    let numbits = 0;
    while (size >= num && numbits < 32) {
        numbits++;
        num *= 2;
    }
    return numbits;
}

function sizeofints(num_of_ints, sizes, sizeofints_bytes) {
    let bytecnt = 1;
    let numbits = 0;
    sizeofints_bytes[0] = 1;
    for (let i = 0; i < num_of_ints; i++) {
        let j;
        let tmp = 0;
        for (j = 0; j < bytecnt; j++) {
            tmp += sizeofints_bytes[j] * sizes[i];
            sizeofints_bytes[j] = tmp & 0xff;
            tmp >>= 8;
        }
        while (tmp !== 0) {
            sizeofints_bytes[j++] = tmp & 0xff;
            tmp >>= 8;
        }
        bytecnt = j;
    }
    let num = 1;
    for (bytecnt--; sizeofints_bytes[bytecnt] >= num;) {
        numbits++;
        num *= 2;
    }
    return numbits + 8 * bytecnt;
}

function receivebits(buf_ptr, buf, num_of_bits, state) {
    const mask = num_of_bits >= 32 ? 0xffffffff : ((1 << num_of_bits) - 1);
    let cnt = state[1];
    let lastbits = state[2];
    let offset = buf_ptr[0];
    let num = 0;

    while (num_of_bits >= 8) {
        lastbits = (lastbits << 8) | buf[offset++];
        num |= (lastbits >> cnt) << (num_of_bits - 8);
        num_of_bits -= 8;
    }

    if (num_of_bits > 0) {
        if (cnt < num_of_bits) {
            cnt += 8;
            lastbits = (lastbits << 8) | buf[offset++];
        }
        cnt -= num_of_bits;
        num |= (lastbits >> cnt) & ((1 << num_of_bits) - 1);
    }

    num = (num & mask) >>> 0;
    buf_ptr[0] = offset;
    buf_ptr[1] = cnt;
    buf_ptr[2] = lastbits;
    return num;
}

function receiveints(buf_ptr, buf, num_of_ints, num_of_bits, sizes, nums, state, receiveints_bytes) {
    let bytes = 0;
    receiveints_bytes[0] = 0;
    receiveints_bytes[1] = 0;
    receiveints_bytes[2] = 0;
    receiveints_bytes[3] = 0;

    while (num_of_bits > 8) {
        receiveints_bytes[bytes++] = receivebits(buf_ptr, buf, 8, state);
        num_of_bits -= 8;
    }
    if (num_of_bits > 0) {
        receiveints_bytes[bytes++] = receivebits(buf_ptr, buf, num_of_bits, state);
    }

    for (let i = num_of_ints - 1; i > 0; i--) {
        let num = 0;
        for (let j = bytes - 1; j >= 0; j--) {
            num = (num * 256) + receiveints_bytes[j];
            const p = Math.floor(num / sizes[i]);
            receiveints_bytes[j] = p;
            num -= p * sizes[i];
        }
        nums[i] = num;
    }
    nums[0] = (receiveints_bytes[0] & 0xff) |
              ((receiveints_bytes[1] & 0xff) << 8) |
              ((receiveints_bytes[2] & 0xff) << 16) |
              ((receiveints_bytes[3] & 0xff) << 24);
}

/**
 * Decodes all XTC frames from an ArrayBuffer or Uint8Array slice into an array of Float32Array coordinates.
 * Coordinates are automatically converted from nanometers (nm) to Ångströms (10x multiplier).
 *
 * @param {ArrayBuffer|Uint8Array} buffer - Binary trajectory buffer containing one or more XTC frames
 * @param {number} [expectedAtoms] - Optional expected atom count for validation
 * @returns {Float32Array[]} Array of decoded coordinate buffers (one Float32Array per frame)
 */
export function decodeHeadlessXtcFrames(buffer, expectedAtoms) {
    if (!buffer) return [];

    let arrayBuffer;
    let byteOffset = 0;
    let byteLength = 0;

    if (buffer instanceof Uint8Array) {
        arrayBuffer = buffer.buffer;
        byteOffset = buffer.byteOffset;
        byteLength = buffer.byteLength;
    } else if (buffer instanceof ArrayBuffer) {
        arrayBuffer = buffer;
        byteOffset = 0;
        byteLength = buffer.byteLength;
    } else if (buffer && buffer.buffer instanceof ArrayBuffer) {
        arrayBuffer = buffer.buffer;
        byteOffset = buffer.byteOffset || 0;
        byteLength = buffer.byteLength || buffer.buffer.byteLength;
    } else {
        return [];
    }

    if (byteLength < 52) {
        return [];
    }

    const dataView = new DataView(arrayBuffer, byteOffset, byteLength);
    const coordinatesList = [];

    const minmax = new Int32Array(6);
    const sizeint = new Int32Array(3);
    const bitsizes = new Int32Array(3);
    const size3 = new Uint32Array(3);
    const thiscoord = new Int32Array(3);
    const prevcoord = new Int32Array(3);

    let offset = 0;
    const buf_ptr = new Int32Array(3);
    const state = new Uint32Array(buf_ptr.buffer);
    const sizeofints_bytes = new Uint8Array(32);
    const receiveints_bytes = new Int32Array(32);

    while (offset + 52 <= byteLength) {
        let magic = dataView.getInt32(offset, false);
        if (magic !== 1995) { // 0x000007CB
            // Scan forward for magic number if misaligned
            let found = false;
            for (let i = offset + 1; i <= byteLength - 52; i++) {
                if (dataView.getInt32(i, false) === 1995) {
                    offset = i;
                    magic = 1995;
                    found = true;
                    break;
                }
            }
            if (!found) break;
        }

        const natoms = dataView.getInt32(offset + 4, false);
        if (natoms <= 0 || natoms > 100000000) {
            break;
        }

        if (expectedAtoms && natoms !== expectedAtoms) {
            console.warn(`[headless-xtc] Frame atom count (${natoms}) does not match expected (${expectedAtoms})`);
        }

        // Skip magic (4), natoms (4), step (4), time (4), box 3x3 (36) = 52 bytes
        offset += 52;

        const totalCoords = 3 * natoms;
        let frameCoords;

        if (natoms <= 9) {
            // Uncompressed coordinate format: raw floats (natoms * 3 floats in nm)
            if (offset + totalCoords * 4 > byteLength) break;
            frameCoords = new Float32Array(totalCoords);
            for (let t = 0; t < totalCoords; ++t) {
                frameCoords[t] = dataView.getFloat32(offset, false) * 10.0;
                offset += 4;
            }
        } else {
            // 3dfx compressed coordinate format (natoms > 9)
            if (offset + 40 > byteLength) break;

            buf_ptr[0] = buf_ptr[1] = buf_ptr[2] = 0;
            sizeint[0] = sizeint[1] = sizeint[2] = 0;
            size3[0] = size3[1] = size3[2] = 0;
            bitsizes[0] = bitsizes[1] = bitsizes[2] = 0;
            thiscoord[0] = thiscoord[1] = thiscoord[2] = 0;
            prevcoord[0] = prevcoord[1] = prevcoord[2] = 0;

            frameCoords = new Float32Array(totalCoords);
            let coordIdx = 0;

            const compressedAtoms = dataView.getInt32(offset, false);
            offset += 4;

            const precision = dataView.getFloat32(offset, false);
            offset += 4;

            let p_flag;
            minmax[0] = dataView.getInt32(offset, false);
            minmax[1] = dataView.getInt32(offset + 4, false);
            minmax[2] = dataView.getInt32(offset + 8, false);
            minmax[3] = dataView.getInt32(offset + 12, false);
            minmax[4] = dataView.getInt32(offset + 16, false);
            minmax[5] = dataView.getInt32(offset + 20, false);

            sizeint[0] = minmax[3] - minmax[0] + 1;
            sizeint[1] = minmax[4] - minmax[1] + 1;
            sizeint[2] = minmax[5] - minmax[2] + 1;
            offset += 24;

            if ((sizeint[0] | sizeint[1] | sizeint[2]) > 16777215) {
                bitsizes[0] = sizeofint(sizeint[0]);
                bitsizes[1] = sizeofint(sizeint[1]);
                bitsizes[2] = sizeofint(sizeint[2]);
                p_flag = 0;
            } else {
                p_flag = sizeofints(3, sizeint, sizeofints_bytes);
            }

            let smallidx = dataView.getInt32(offset, false);
            offset += 4;

            let minsmallidx = smallidx - 1;
            minsmallidx = (9 > minsmallidx) ? 9 : minsmallidx;
            let minsmall = (MAGICINTS[minsmallidx] / 2) | 0;
            let maxsmall = (MAGICINTS[smallidx] / 2) | 0;
            size3[0] = size3[1] = size3[2] = MAGICINTS[smallidx];

            const lsize = dataView.getInt32(offset, false);
            const paddedLsize = (lsize + 3) & ~3;
            offset += 4;

            if (lsize <= 0 || offset + paddedLsize > byteLength) break;

            // Direct conversion from quantized integer grid to Ångströms (10.0 / precision)
            const scaleToAngstrom = precision > 0 ? (10.0 / precision) : 0.01;
            let run = 0;
            let atomCount = 0;
            const compressedBytes = new Uint8Array(arrayBuffer, byteOffset + offset, lsize);

            for (thiscoord[0] = thiscoord[1] = thiscoord[2] = 0; atomCount < compressedAtoms;) {
                if (0 === p_flag) {
                    thiscoord[0] = receivebits(buf_ptr, compressedBytes, bitsizes[0], state);
                    thiscoord[1] = receivebits(buf_ptr, compressedBytes, bitsizes[1], state);
                    thiscoord[2] = receivebits(buf_ptr, compressedBytes, bitsizes[2], state);
                } else {
                    receiveints(buf_ptr, compressedBytes, 3, p_flag, sizeint, thiscoord, state, receiveints_bytes);
                }

                atomCount++;
                thiscoord[0] += minmax[0];
                thiscoord[1] += minmax[1];
                thiscoord[2] += minmax[2];

                prevcoord[0] = thiscoord[0];
                prevcoord[1] = thiscoord[1];
                prevcoord[2] = thiscoord[2];

                let flag = 0;
                if (1 === receivebits(buf_ptr, compressedBytes, 1, state)) {
                    run = receivebits(buf_ptr, compressedBytes, 5, state);
                    flag = run % 3;
                    run -= flag;
                    flag--;
                }

                if (run > 0) {
                    thiscoord[0] = thiscoord[1] = thiscoord[2] = 0;
                    for (let r = 0; r < run; r += 3) {
                        receiveints(buf_ptr, compressedBytes, 3, smallidx, size3, thiscoord, state, receiveints_bytes);
                        atomCount++;
                        thiscoord[0] += prevcoord[0] - maxsmall;
                        thiscoord[1] += prevcoord[1] - maxsmall;
                        thiscoord[2] += prevcoord[2] - maxsmall;

                        if (0 === r) {
                            let tmp = thiscoord[0]; thiscoord[0] = prevcoord[0]; prevcoord[0] = tmp;
                            tmp = thiscoord[1]; thiscoord[1] = prevcoord[1]; prevcoord[1] = tmp;
                            tmp = thiscoord[2]; thiscoord[2] = prevcoord[2]; prevcoord[2] = tmp;

                            frameCoords[coordIdx++] = prevcoord[0] * scaleToAngstrom;
                            frameCoords[coordIdx++] = prevcoord[1] * scaleToAngstrom;
                            frameCoords[coordIdx++] = prevcoord[2] * scaleToAngstrom;
                        } else {
                            prevcoord[0] = thiscoord[0];
                            prevcoord[1] = thiscoord[1];
                            prevcoord[2] = thiscoord[2];
                        }

                        frameCoords[coordIdx++] = thiscoord[0] * scaleToAngstrom;
                        frameCoords[coordIdx++] = thiscoord[1] * scaleToAngstrom;
                        frameCoords[coordIdx++] = thiscoord[2] * scaleToAngstrom;
                    }
                } else {
                    frameCoords[coordIdx++] = thiscoord[0] * scaleToAngstrom;
                    frameCoords[coordIdx++] = thiscoord[1] * scaleToAngstrom;
                    frameCoords[coordIdx++] = thiscoord[2] * scaleToAngstrom;
                }

                smallidx += flag;
                if (flag < 0) {
                    maxsmall = minsmall;
                    minsmall = (smallidx > 9) ? ((MAGICINTS[smallidx - 1] / 2) | 0) : 0;
                } else if (flag > 0) {
                    minsmall = maxsmall;
                    maxsmall = (MAGICINTS[smallidx] / 2) | 0;
                }
                size3[0] = size3[1] = size3[2] = MAGICINTS[smallidx];

                if (0 === size3[0] || 0 === size3[1] || 0 === size3[2]) {
                    console.error("[headless-xtc] Undefined error in 3dfx decompression");
                    break;
                }
            }

            offset += paddedLsize;
        }

        coordinatesList.push(frameCoords);
    }

    return coordinatesList;
}