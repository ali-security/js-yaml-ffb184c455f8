'use strict';


const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const distDir = path.resolve(__dirname, '../../dist');

const mergePayload = `
payload: &ref
  polluted: bar

foo:
  <<:
    __proto__: *ref
`;


// The bundles in dist/ are what `import 'js-yaml'` (package.json#module and
// #exports.import) and every unpkg/jsdelivr consumer actually execute, so the
// prototype pollution fix must be present there as well. They are generated
// from lib/ by `npm run browserify`, which CI runs before the tests.
describe('issue 164 (dist bundles)', function () {
  [ 'js-yaml.js', 'js-yaml.min.js' ].forEach(function (bundle) {
    it('should define __proto__ as a value (not invoke setter) in ' + bundle, function () {
      const jsyaml = require(path.join(distDir, bundle));
      const object = jsyaml.load('{ __proto__: {polluted: bar} }');

      assert.strictEqual(({}).hasOwnProperty.call(object, '__proto__'), true);
      assert.strictEqual(Object.getPrototypeOf(object), Object.prototype);
      assert(!object.polluted);
    });

    it('should merge __proto__ as a value with << operator in ' + bundle, function () {
      const jsyaml = require(path.join(distDir, bundle));
      const object = jsyaml.load(mergePayload);

      assert.strictEqual(({}).hasOwnProperty.call(object.foo, '__proto__'), true);
      assert.strictEqual(Object.getPrototypeOf(object.foo), Object.prototype);
      assert(!object.foo.polluted);
      assert(!({}).polluted);
    });
  });

  // Node 12 cannot require() an ES module, so check the esm bundle as text:
  // `destination[key] = source[key]` is the vulnerable merge assignment.
  it('should not assign merge keys directly in js-yaml.mjs', function () {
    const source = fs.readFileSync(path.join(distDir, 'js-yaml.mjs'), 'utf8');

    assert.strictEqual(source.indexOf('destination[key] = source[key]'), -1);
    assert.notStrictEqual(source.indexOf('function setProperty('), -1);
  });
});
