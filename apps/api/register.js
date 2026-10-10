const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

require('reflect-metadata');

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  esModuleInterop: true,
};

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  if (request.startsWith('.') && parent && parent.filename.endsWith('.ts') && path.extname(request) === '') {
    const base = path.resolve(path.dirname(parent.filename), request);
    for (const extension of ['.ts', '.js', '.json']) {
      if (fs.existsSync(base + extension)) {
        return resolveFilename.call(this, `${request}${extension}`, parent, isMain, options);
      }
    }
  }
  return resolveFilename.call(this, request, parent, isMain, options);
};

Module._extensions['.ts'] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { fileName: filename, compilerOptions }).outputText;
  module._compile(output, filename);
};
