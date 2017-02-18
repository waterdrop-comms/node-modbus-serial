'use strict';
var util = require('util');
var events = require('events');
var EventEmitter = events.EventEmitter || events;
var SerialPort = require("serialport");

var EXCEPTION_LENGTH = 5;
var MAX_BUFFER_LENGTH = 256;

/**
 * Simulate a modbus-RTU port using buffered serial connection
 */
var RTUBufferedPort = function(path, options) {
    var self = this;

    // options
    if (typeof(options) == 'undefined') options = {};

    // disable auto open, as we handle the open
    options.autoOpen = false;

    // internal buffer
    this._buffer = new Buffer(0);
    this._id = 0;
    this._cmd = 0;
    this._length = 0;
    this.debug = false;

    // create the SerialPort
    this._client= new SerialPort(path, options);

    // register the port data event
    this._client.on('data', function onData(data) {
        // add data to buffer
        self._buffer = Buffer.concat([self._buffer, data]);

        // check if buffer include a complete modbus answer
        var expectedLength = self._length;
        var bufferLength = self._buffer.length;

        // check data length
        if (expectedLength < 6 || bufferLength < EXCEPTION_LENGTH) return;

        // check buffer size for MAX_BUFFER_SIZE
        if (bufferLength > MAX_BUFFER_LENGTH) {
            self._buffer = self._buffer.slice(-MAX_BUFFER_LENGTH);
        }

        // loop and check length-sized buffer chunks
        var maxOffset = bufferLength - EXCEPTION_LENGTH;
        for (var i = 0; i <= maxOffset; i++) {
            var unitId = self._buffer[i];
            var functionCode = self._buffer[i+1];

            if (unitId !== self._id) continue;

            if (functionCode === self._cmd && i + expectedLength <= bufferLength) {
                self._emitData(i, expectedLength);
                return;
            }
            if (functionCode === (0x80 | self._cmd) && i + EXCEPTION_LENGTH <= bufferLength) {
                self._emitData(i, EXCEPTION_LENGTH);
                return;
            }

            // frame header matches, but still missing bytes pending
            if (functionCode === (0x7f & self._cmd)) break;
        }
    });

    EventEmitter.call(this);
};
util.inherits(RTUBufferedPort, EventEmitter);

/**
 * Emit the received response, cut the buffer and reset the internal vars.
 * @param {number} start the start index of the response within the buffer
 * @param {number} length the length of the response
 * @private
 */
RTUBufferedPort.prototype._emitData = function(start, length) {
    var buffer = this._buffer.slice(start, start + length);

    // emit debug message
    if (this.debug) { this.emit('debug', {action: 'recive', data: buffer}); }

    this.emit('data', buffer);
    this._buffer = this._buffer.slice(start + length);
};

/**
 * Simulate successful port open
 */
RTUBufferedPort.prototype.open = function (callback) {
    this._client.open(callback);
};

/**
 * Simulate successful close port
 */
RTUBufferedPort.prototype.close = function (callback) {
    this._client.close(callback);
};

/**
 * Check if port is open
 */
RTUBufferedPort.prototype.isOpen = function() {
    return this._client.isOpen();
};

/**
 * Send data to a modbus slave
 */
RTUBufferedPort.prototype.write = function (data) {
    // check data length
    if (data.length < 6) {
        // raise an error ?
        return;
    }

    // remember current unit and command
    this._id = data[0];
    this._cmd = data[1];

    // calculate expected answer length
    switch (this._cmd) {
        case 1:
        case 2:
            var length = data.readUInt16BE(4);
            this._length = 3 + parseInt((length - 1) / 8 + 1) + 2;
            break;
        case 3:
        case 4:
            var length = data.readUInt16BE(4);
            this._length = 3 + 2 * length + 2;
            break;
        case 5:
        case 6:
        case 15:
        case 16:
            this._length = 6 + 2;
            break;
        default:
            // raise and error ?
            this._length = 0;
            break;
    }

    // emit debug message
    if (this.debug) { this.emit('debug', {action: 'send', data: data}); }

    // send buffer to slave
    this._client.write(data);
};

module.exports = RTUBufferedPort;
