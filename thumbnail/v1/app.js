'use strict';

const { createServer } = require('http');
const { readFileSync, writeFileSync } = require('fs');
const { resolve: resolvePath } = require('path');
const zlib = require('zlib');

const crcForBuffer = crcForBufferFactory();

const basePath = __dirname; // serving files from here

function makeThumbnailProm(imgDataBuf) {
  return new Promise((resolve, reject) => {
    let result;
    try {
      result = parsePng(imgDataBuf);
    } catch (err) {
      reject(err);
      return;
    }
    resolve(result);
  });
}

function parsePng(imgDataBuf) {
  const preambleBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let ihdr;
  let compressedPixelData = Buffer.alloc(0);
  let pixelData;
  if (preambleBuf.compare(imgDataBuf, 0, preambleBuf.byteLength) !== 0) {
    throw new Error('no valid PNG preamble');
  }
  let offset = preambleBuf.byteLength; // chunks start after the preamble
  while (offset < imgDataBuf.byteLength) {
    const { chLength, chType, chData } = readChunk(imgDataBuf, offset);
    offset += chLength + 12; // total chunk size is 4 (length) + 4 (type) + chLength + 4 (CRC)
    switch (chType) {
      case 'IHDR': {
        ihdr = readIhdrFromChunkData(chData);
        break;
      }
      case 'IDAT': {
        compressedPixelData = Buffer.concat([compressedPixelData, chData]);
        break;
      }
    }
  }
  if (offset !== imgDataBuf.byteLength) {
    throw new Error(`parsed length (${offset}) does not match buffer length (${imgDataBuf.byteLength})`);
  }
  pixelData = zlib.inflateSync(compressedPixelData);
  const { width, height, colorType } = ihdr;
  const bytesPerPixel = (colorType & 4) ? 4 : 3;
  const scanlinePixelBytes = width * bytesPerPixel;
  const scanlineTotalBytes = scanlinePixelBytes + 1; // plus filter type byte at the beginning of each line
  for (let scanlineIdx = 0; scanlineIdx < height; scanlineIdx += 1) {
    const scanlineStart = scanlineIdx * scanlineTotalBytes;
    const pixelStart = scanlineStart + 1;
    const filterType = pixelData[scanlineStart];
    if (filterType === 0) {
      // none, nothing to do
    } else if (filterType === 1) {
      // sub
      for (let i = 0; i < scanlinePixelBytes; i += 1) {
        pixelData[pixelStart + i] = (i < bytesPerPixel) ? pixelData[pixelStart + i] :
          pixelData[pixelStart + i] + pixelData[pixelStart + i - bytesPerPixel];
      }
      pixelData[scanlineStart] = 0; // filter none
    } else if (filterType === 2) {
      // up
      for (let i = 0; i < scanlinePixelBytes; i += 1) {
        pixelData[pixelStart + i] = (scanlineIdx === 0) ? pixelData[pixelStart + i] :
          pixelData[pixelStart + i] + pixelData[pixelStart + i - scanlineTotalBytes];
      }
      pixelData[scanlineStart] = 0; // filter none
    } else {
      throw new Error(`unsupported filter type ${filterType}`);
    }
  }

  // modify
  for (let scanlineIdx = 0; scanlineIdx < height; scanlineIdx += 1) {
    const scanlineStart = scanlineIdx * scanlineTotalBytes;
    const pixelStart = scanlineStart + 1;
    for (let i = 0; i < scanlinePixelBytes; i += bytesPerPixel) {
      pixelData[pixelStart + i + 0] = 0.1 * pixelData[pixelStart + i + 0]; // red
      pixelData[pixelStart + i + 1] = 2 * pixelData[pixelStart + i + 1]; // green
      pixelData[pixelStart + i + 2] = 3 * pixelData[pixelStart + i + 2]; // blue
      if (bytesPerPixel === 4) {
        pixelData[pixelStart + i + 3] = pixelData[pixelStart + i + 3]; // alpha
      }
    }
  }

  // construct
  const outBuf = Buffer.alloc(2 * imgDataBuf.byteLength); // same size so far
  offset = writePreambleToBuffer(outBuf);
  offset = writeIhdrChunkToBuffer(ihdr, outBuf, offset);
  const newCompressedPixelData = zlib.deflateSync(pixelData);
  offset = writeIdatChunkToBuffer(newCompressedPixelData, outBuf, offset);
  offset = writeIendChunkToBuffer(outBuf, offset);
  return outBuf.slice(0, offset);

  function readIhdrFromChunkData(chunkData) {
    let offset = 0;
    const width = chunkData.readUInt32BE(offset);
    offset += 4;
    const height = chunkData.readUInt32BE(offset);
    offset += 4;
    const bitDepth = chunkData.readUInt8(offset);
    offset += 1;
    const colorType = chunkData.readUInt8(offset);
    offset += 1;
    const compressionMethod = chunkData.readUInt8(offset);
    offset += 1;
    const filterMethod = chunkData.readUInt8(offset);
    offset += 1;
    const interlaceMethod = chunkData.readUInt8(offset);
    offset += 1;
    if (chunkData.byteLength !== offset) {
      throw new Error(`parsed length (${offset}) does not match chunk data length (${chunkData.byteLength})`);
    }
    return {
      width,
      height,
      bitDepth,
      colorType, //  1 (palette used), 2 (color used), and 4 (alpha channel used). Valid values are 0, 2, 3, 4, and 6.
      compressionMethod,
      filterMethod,
      interlaceMethod
    };
  }

  function writePreambleToBuffer(buf) { // start offset is 0
    return preambleBuf.copy(buf);
  }

  function writeIhdrChunkToBuffer(ihdr, buf, offsetArg) {
    const { width, height, bitDepth, colorType, compressionMethod, filterMethod, interlaceMethod } = ihdr;
    const chLength = 13; // data
    let offset = offsetArg;
    offset = buf.writeUInt32BE(chLength, offset);
    const crcCalculationStart = offset;
    offset += buf.write('IHDR', offset);
    offset = buf.writeUInt32BE(width, offset);
    offset = buf.writeUInt32BE(height, offset);
    offset = buf.writeUInt8(bitDepth, offset);
    offset = buf.writeUInt8(colorType, offset);
    offset = buf.writeUInt8(compressionMethod, offset);
    offset = buf.writeUInt8(filterMethod, offset);
    offset = buf.writeUInt8(interlaceMethod, offset);
    const crcCalculationEnd = offset;
    offset = buf.writeUInt32BE(crcForBuffer(buf.slice(crcCalculationStart, crcCalculationEnd)), offset);
    return offset;
  }

  function writeIdatChunkToBuffer(imgData, buf, offsetArg) {
    const chLength = imgData.byteLength;
    let offset = offsetArg;
    offset = buf.writeUInt32BE(chLength, offset);
    const crcCalculationStart = offset;
    offset += buf.write('IDAT', offset);
    offset += imgData.copy(buf, offset);
    const crcCalculationEnd = offset;
    offset = buf.writeUInt32BE(crcForBuffer(buf.slice(crcCalculationStart, crcCalculationEnd)), offset);
    return offset;
  }

  function writeIendChunkToBuffer(buf, offsetArg) {
    const chLength = 0; // no data
    let offset = offsetArg;
    offset = buf.writeUInt32BE(chLength, offset);
    const crcCalculationStart = offset;
    offset += buf.write('IEND', offset);
    const crcCalculationEnd = offset;
    offset = buf.writeUInt32BE(crcForBuffer(buf.slice(crcCalculationStart, crcCalculationEnd)), offset);
    return offset;
  }

  function readChunk(buf, offsetArg) {
    let offset = offsetArg;
    // chunk length
    const chLength = buf.readUint32BE(offset);
    if (buf.byteLength < offset + chLength + 12) {
      throw new Error(`invalid chunk length (${chLength}) at byte ${offset}`);
    }
    offset += 4; // uint32
    const crcCalculationStart = offset;
    // chunk type
    const chType = imgDataBuf.toString('utf8', offset, offset + 4);
    offset += 4;
    // chunk data
    const chData = imgDataBuf.slice(offset, offset + chLength);
    offset += chLength;
    const crcCalculationEnd = offset;
    // chunk CRC
    const chCrc = imgDataBuf.readUint32BE(offset);
    const calculatedCrc = new Uint32Array(1);
    calculatedCrc[0] = crcForBuffer(buf.slice(crcCalculationStart, crcCalculationEnd));
    if (chCrc !== calculatedCrc[0]) {
      throw new Error(`CRC mismatch in chunk of type ${chType}`);
    }
    return {
      chLength,
      chType,
      chData
    };
  }

  function formatImageData() {
    const rowLen = width * bytesPerPixel + 1;
    let output = '';
    for (let i = 0; i < pixelData.byteLength; i += rowLen) {
      for (let j = 0; j < rowLen && i + j < pixelData.byteLength; j += 1) {
        if (0 === (j - 1) % bytesPerPixel) {
          output += ' ';
        }
        output += `${('0' + pixelData[i + j].toString(16)).slice(-2)} `;
      }
      output += '\n';
    }
    return output;
  }
}

function crcForBufferFactory() {
  const crcTable = (function initTable() {
    const tableSize = 256;
    const result = new Uint32Array(tableSize);
    const c = new Uint32Array(1); // unsigned long
    for (let n = 0; n < tableSize; n += 1) {
      c[0] = n;
      for (let k = 0; k < 8; k += 1) {
        if (c[0] & 1) {
          c[0] = 0xedb88320 ^ (c[0] >>> 1);
        } else {
          c[0] = c[0] >>> 1;
        }
        result[n] = c[0];
      }
    }
    return result;
  }());

  return function crcForBuffer(buffer) {
    const buf = Uint8Array.from(buffer);
    const result = new Uint32Array(1);
    result[0] = calculateCrc(0xffffffff, buf, buf.byteLength) ^ 0xffffffff; // 1's complement
    return result[0];
  };

  function calculateCrc(startCrc, buf, bufLength) {
    const c = new Uint32Array(1);
    c[0] = startCrc;
    let n;
    for (let n = 0; n < bufLength; n += 1) {
      c[0] = crcTable[(c[0] ^ buf[n]) & 0xff] ^ (c[0] >>> 8);
    }
    return c[0];
  }
}

function handleHttpReq(req, res) {
  let reqPath = req.url;
  if (reqPath.startsWith('//')) {
    reqPath = reqPath.slice(1);
  }
  console.log(`Got: ${reqPath}`);
  if (reqPath === '/') {
    let pageContent;
    try {
      pageContent = readFileSync(`${basePath}/page.html`);
    } catch (err) {
      console.log(`Error reading page: ${err.message}`);
      res.statusCode = 503;
      res.end(`Error reading page: ${err.message}`);
      return;
    }
    res.statusCode = 200;
    res.end(pageContent);
    return;
  }
  if (reqPath === '/thumbnail') {
    req.on('error', err => {
      console.log(`Error reading body: ${err.message}`);
      res.statusCode = 503;
      res.end(`Error reading body: ${err.message}`);
      return;
    });
    let bodyBuf = Buffer.alloc(0);
    req.on('data', chunkBuf => {
      bodyBuf = Buffer.concat([bodyBuf, chunkBuf]);
    });
    req.on('end', () => {
      makeThumbnailProm(bodyBuf)
        .then(thumbnail => {
          res.setHeader('Content-Type', 'image/png');
          res.statusCode = 200;
          res.end(thumbnail);
        })
        .catch(reason => {
          console.log(`Error making thumbnail: ${reason}`);
          res.statusCode = 503;
          res.end(`Error making thumbnail: ${reason}`);
          return;
        });
    });
    return;
  }
  // all other requests
  while (reqPath.startsWith('/')) {
    reqPath = reqPath.slice(1);
  }
  if (reqPath.includes('..')) {
    console.log(`Bad path "${reqPath}"`);
    res.statusCode = 404;
    res.end('Bad path');
    return;
  }

  let pageContent;

  try {
    pageContent = readFileSync(`${basePath}/${reqPath}`);
  } catch (err) {
    console.log(`Error reading file: ${err.message}`);
    res.statusCode = 404;
    res.end(`Error reading file: ${err.message}`);
    return;
  }
  res.statusCode = 200;
  res.end(pageContent);
}

const jobIndex = process.env.JOB_INDEX;

if (jobIndex) {
  // run as job
} else {
  // run as app
  const server = createServer(handleHttpReq);
  server.listen(8080, () => {
    console.log(`Listening on port 8080`);
  });
}
