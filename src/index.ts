// This is a special file to make playable from the source code produced by ng build --prod.
// It mostly contains various heuristics and hacks, rather than the robust solution.
// Copyright (c) Andrew Anisimov, Dazlab (https://dazlab.global/).

// 1. First hack will be to inline all scripts, styles and images produced by the standard build.
//    We honestly use the existing `html-inline` tool for that (https://github.com/substack/html-inline),
//    but with all the unnecessary stuff stripped out.
//
// 2. Second hack will be to replace some regular expression literals in the produces scripts
//    which Playable Preview Tool escapes for some reason, making the script invalid.
//    e.g. `/</g` is replaced with `new RegExp('<', 'g')` and so on.

import {BrowserBuilderOptions, executeBrowserBuilder} from '@angular-devkit/build-angular';
import {json} from '@angular-devkit/core';
import {BuilderContext, createBuilder} from '@angular-devkit/architect';
import {Readable, Transform} from 'stream';
import * as fs from 'fs';
import * as path from 'path';

const trumpet: any = require('trumpet'); // FIXME: get rid of this dependency (replace with TS one)

class ReadableString extends Readable {
    private sent = false;

    constructor(private str: string) {
        super();
    }

    _read(): void {
        if (!this.sent) {
            this.push(Buffer.from(this.str));
            this.sent = true;
        } else {
            this.push(null);
        }
    }
}

export const buildCustomWebpackBrowser = (
    options: BrowserBuilderOptions,
    context: BuilderContext
): ReturnType<typeof executeBrowserBuilder> =>
    executeBrowserBuilder(options, context, {
        indexHtml(html: string): Promise<string> {
            return transformIndexHtml(html, options.outputPath);
        }
    });

function transformIndexHtml(html: string, outputPath: string): Promise<string> {
    const stream: NodeJS.WritableStream = new ReadableString(html)
        .pipe(inlineHtml(outputPath));
    return new Promise((resolve, reject) => {
        let result = '';
        stream.on('data', (data) => {
            result += data.toString();
        });
        stream.on('end', () => {
            resolve(result);
        });
        stream.on('error', (err) => {
            reject(err);
        });
    });
}

function streamReplace(needle: any, replacer: string) {
    let chunks: any[] = [], len = 0, pos = 0;
    return new Transform({
        transform(chunk: any, encoding: string, callback: (error?: (Error | null), data?: any) => void): void {
            chunks.push(chunk);
            len += chunk.length;
            if (pos === 1) {
                const data = Buffer.concat(chunks, len)
                    .toString()
                    .replace(needle, replacer);

                // TODO: examine and profile garbage
                chunks = [];
                len = 0;

                this.push(data);
            }
            pos = 1 ^ pos;
            callback(null);
        },

        flush(callback: (error?: (Error | null), data?: any) => void): void {
            if (chunks.length) {
                this.push(Buffer.concat(chunks, len)
                    .toString()
                    .replace(needle, replacer))
            }
            callback(null);
        }
    });
}

function inlineHtml(basedir: string): NodeJS.WritableStream {
    const tr = trumpet();

    tr.selectAll('script[src]', function (node: any) {
        const file = fix(node.getAttribute('src'));
        node.removeAttribute('src');
        node.removeAttribute('defer'); // this is the minor change in html-inline lib.
        fs.createReadStream(file)
            .pipe(streamReplace(/\/([<>]+?)\/([gi]{1,2})/g, 'new RegExp(\'$1\', \'$2\')')) // THIS IS THE MAIN CHANGE IN html-inline
            .pipe(node.createWriteStream());
    });

    tr.selectAll('img[src]', function (node: any) {
        inline64(node, 'src');
    });

    tr.selectAll('link[href]', function (node: any) {
        const rel = (node.getAttribute('rel') || '').toLowerCase();
        if (rel === 'stylesheet') return;
        inline64(node, 'href');
    });

    tr.selectAll('link[href]', function (node: any) {
        const rel = node.getAttribute('rel').toLowerCase();
        if (rel !== 'stylesheet') return;
        const file = fix(node.getAttribute('href'));

        const w = node.createWriteStream({outer: true});
        w.write('<style>');
        const r = fs.createReadStream(file);
        r.pipe(w, {end: false});
        r.on('end', function () {
            w.end('</style>')
        });
    });

    return tr;

    function fix(p: string): string {
        if (path.isAbsolute(p)) {
            return path.resolve(basedir, path.relative('/', p));
        } else {
            return path.resolve(basedir, p);
        }
    }

    function enc(s: string): string {
        return s.replace(/"/g, '&#34;')
            .replace(/>/g, '&gt;')
            .replace(/</g, '&lt;')
            ;
    }

    function inline64(node: any, name: string) {
        const href = node.getAttribute(name);
        if (/^data:/.test(href)) return;
        const file = fix(href);
        const w = node.createWriteStream({outer: true});
        const attrs = node.getAttributes();
        w.write('<' + node.name);
        Object.keys(attrs).forEach(function (key) {
            if (key === name) return;
            w.write(' ' + key + '="' + enc(attrs[key]) + '"');
        });
        const ext = path.extname(file).replace(/^\./, '').toLowerCase();
        let type = node.getAttribute('type');
        if (!type) type = {
            svg: 'image/svg+xml',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/jpeg'
        }[ext] || 'image/png';
        w.write(' ' + name + '="data:' + type + ';base64,');

        let last: any = null;
        fs.createReadStream(file).pipe(new Transform({
            transform(chunk: any, encoding: string, callback: (error?: (Error | null), data?: any) => void): void {
                let buf: Buffer;
                if (last) {
                    buf = Buffer.concat([last, chunk]);
                    last = null;
                } else {
                    buf = Buffer.from(chunk);
                }
                let b;
                if (buf.length % 3 === 0) {
                    b = buf;
                } else {
                    b = buf.slice(0, buf.length - buf.length % 3);
                    last = buf.slice(buf.length - buf.length % 3);
                }
                w.write(b.toString('base64'));
                callback();
            },

            final(): void {
                if (last) w.write(last.toString('base64'));
                w.end('">');
            }
        }));
    }
}

export default createBuilder<json.JsonObject & BrowserBuilderOptions>(
    buildCustomWebpackBrowser
);
