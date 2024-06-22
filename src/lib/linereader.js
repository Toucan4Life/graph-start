/*
Written by Peter O.

Any copyright to this work is released to the Public Domain.
In case this is not possible, this work is also
licensed under Creative Commons Zero (CC0):
https://creativecommons.org/publicdomain/zero/1.0/

*/
export class LineReader {
    constructor(file) {
        this.file = file;
        this.reader = new FileReader();
        this.offset = 0;
        this.currentLine = "";
        this.bufferOffset = 0;
        this.lastBuffer = null;
        this.callback = null;
        this.omittedCR = false;
        this.sawCR = false;
        this.endCallback = null;
        this.decodeOptions = { "stream": true };
        this.decoder = new TextDecoder("utf-8", { "ignoreBOM": true });
        this.reader.addEventListener("load", this._viewLoaded.bind(this));
        this.reader.addEventListener("error", this._error.bind(this));
    }
    _error(e) {
        throw e;
    }
    _readFromView(a, offset) {
        var lineEnd = 0;
        for (var i = offset; i < a.length; i++) {
            // Treats LF and CRLF as line breaks
            if (a[i] == 0x0A) {
                // Line feed read
                lineEnd = (this.sawCR ? i - 1 : i);
                if (lineEnd > 0) {
                    this.currentLine += this.decoder.decode(a.slice(this.bufferOffset, lineEnd), this.decodeOptions);
                }
                if (this.callback) this.callback(this.currentLine);
                this.decoder.decode(new Uint8Array([]));
                this.currentLine = "";
                this.sawCR = false;
                this.bufferOffset = i + 1;
                this.lastBuffer = a;
            } else if (a[i] == 0x0D) {
                if (this.omittedCR) this.currentLine += "\r";
                this.sawCR = true;
            } else if (this.sawCR) {
                if (this.omittedCR) this.currentLine += "\r";
                this.sawCR = false;
            }
            this.omittedCR = false;
        }
        if (this.bufferOffset != a.length) {
            // Decode the end of the line if no current line was reached
            lineEnd = (this.sawCR ? a.length - 1 : a.length);
            if (lineEnd > 0) {
                this.currentLine += this.decoder.decode(a.slice(this.bufferOffset, lineEnd), this.decodeOptions);
            }
            this.omittedCR = this.sawCR;
        }
    }
    _viewLoaded() {
        var a = new Uint8Array(this.reader.result);
        if (a.length > 0) {
            this.bufferOffset = 0;
            this._readFromView(a, 0);
            this.offset += a.length;
            var s = this.file.slice(this.offset, this.offset + 256);
            this.reader.readAsArrayBuffer(s);
        } else {
            if (this.callback && this.currentLine.length > 0) {
                this.callback(this.currentLine);
            }
            this.decoder.decode(new Uint8Array([]));
            this.currentLine = "";
            this.sawCR = false;
            if (this.endCallback) {
                this.endCallback();
            }
        }
    }
    readLines(callback, endCallback) {
        this.callback = callback;
        this.endCallback = endCallback;
        var s = this.file.slice(this.offset, this.offset + 8192);
        this.reader.readAsArrayBuffer(s);
    }
}

